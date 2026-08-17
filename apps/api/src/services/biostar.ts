import { Agent as UndiciAgent, fetch as undiciFetch } from 'undici';
import type { AttendanceDevice } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { decrypt } from './crypto';
import { ingestPunches, type Punch } from './attendanceIngest';

/**
 * Suprema BioLite Net (and other BioStar 2 terminals) don't push punches to a
 * URL the way a ZKTeco ADMS device does — they report into a BioStar 2 server
 * running on the site LAN, and BioStar 2 is what exposes a REST API. So the
 * integration shape is necessarily different from iclock.ts: we log into that
 * BioStar 2 server and poll it for new events, on an interval, rather than
 * waiting for the terminal to call us.
 *
 * This targets BioStar 2's documented REST API (session-cookie auth, JSON
 * event search). Suprema has shipped several BioStar 2 releases with minor API
 * differences — the event-type codes below are the standard "Verify Success" /
 * "Identify Success" codes as of BioStar 2.8+; if a specific deployment's
 * events don't show up, check its Monitoring > Event log for the exact
 * event_type_id it logs on a successful fingerprint match and adjust
 * SUCCESS_EVENT_TYPES. Firmware/version-specific tuning here is expected, the
 * same way iclock.ts flags for ZKTeco.
 */

const SESSION_HEADER = 'bs-session-id';

// BioStar 2's standard "authentication succeeded" event codes. 4864 (0x1300)
// is Verify Success (1:1, fingerprint + ID/card); 4865 (0x1301) is Identify
// Success (1:N, fingerprint alone) — BioLite Net supports both modes.
const SUCCESS_EVENT_TYPES = [4864, 4865];

export class BiostarError extends Error {}

// Node's global fetch has no per-request TLS control, and rejectUnauthorized
// must never be a process-wide setting — one misbehaving BioStar 2 self-signed
// cert should not weaken every other outbound HTTPS call this server makes.
// undici's per-request `dispatcher` is what makes it possible to scope the
// bypass to exactly the devices an admin has explicitly opted in.
const secureAgent = new UndiciAgent();
const insecureAgent = new UndiciAgent({ connect: { rejectUnauthorized: false } });

/** Narrows an unknown JSON body to something indexable, or undefined. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Reads a string property off a narrowed body, or undefined. */
function stringAt(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' ? value : undefined;
}

async function biostarFetch(
  device: Pick<AttendanceDevice, 'biostarBaseUrl' | 'biostarInsecureTls'>,
  path: string,
  init: { method?: string; body?: unknown; sessionId?: string } = {},
  // BioStar 2's payloads are vendor-shaped and undocumented per-endpoint;
  // callers narrow what they need rather than us modelling the whole API.
): Promise<{ json: unknown; sessionId?: string }> {
  if (!device.biostarBaseUrl) throw new BiostarError('No BioStar 2 server address configured');
  const url = `${device.biostarBaseUrl.replace(/\/$/, '')}${path}`;
  const res = await undiciFetch(url, {
    method: init.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(init.sessionId ? { [SESSION_HEADER]: init.sessionId } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    dispatcher: device.biostarInsecureTls ? insecureAgent : secureAgent,
  });
  if (!res.ok) {
    throw new BiostarError(
      `BioStar 2 request failed: ${init.method ?? 'GET'} ${path} -> ${res.status}`,
    );
  }
  const json: unknown = await res.json().catch(() => ({}));
  return { json, sessionId: res.headers.get(SESSION_HEADER) ?? undefined };
}

/** Logs into BioStar 2, returning the session id used on subsequent calls. */
export async function biostarLogin(
  device: Pick<
    AttendanceDevice,
    'biostarBaseUrl' | 'biostarLoginId' | 'biostarPasswordEnc' | 'biostarInsecureTls'
  >,
): Promise<string> {
  if (!device.biostarLoginId || !device.biostarPasswordEnc) {
    throw new BiostarError('BioStar 2 login credentials are not configured for this device');
  }
  const password = decrypt(device.biostarPasswordEnc);
  const { json, sessionId } = await biostarFetch(device, '/api/login', {
    method: 'POST',
    body: { User: { login_id: device.biostarLoginId, password } },
  });
  // BioStar 2 has returned the session id in three different places across
  // firmware versions, hence the ladder. `json` is unknown, so read it through
  // a narrowing helper rather than trusting the shape.
  const body = asRecord(json);
  const id =
    sessionId ??
    stringAt(asRecord(body?.Response), SESSION_HEADER) ??
    stringAt(body, SESSION_HEADER);
  if (!id) throw new BiostarError('BioStar 2 login did not return a session id');
  return id;
}

interface BiostarEvent {
  ID: string;
  datetime: string;
  user_id?: string;
  device_id?: { id: string };
  event_type_id?: number;
}

/** Fetches success events after `sinceEventId`, oldest first, capped per call. */
async function fetchEventsSince(
  device: Pick<AttendanceDevice, 'biostarBaseUrl' | 'biostarInsecureTls' | 'biostarDeviceId'>,
  sessionId: string,
  sinceEventId: string | null,
): Promise<BiostarEvent[]> {
  const conditions: unknown[] = [
    { column: 'event_type_id', operator: 0, values: SUCCESS_EVENT_TYPES },
  ];
  if (sinceEventId) conditions.push({ column: 'id', operator: 3, values: [sinceEventId] }); // 3 = greater-than
  if (device.biostarDeviceId) {
    conditions.push({ column: 'device_id', operator: 0, values: [device.biostarDeviceId] });
  }
  const { json } = await biostarFetch(device, '/api/events/search', {
    method: 'POST',
    sessionId,
    body: {
      Query: {
        limit: 500,
        orders: [{ column: 'id', descending: false }],
        conditions,
        columns: ['ID', 'datetime', 'user_id', 'device_id', 'event_type_id'],
      },
    },
  });
  const body = asRecord(json);
  const rows = body?.Events ?? body?.EventList;
  return Array.isArray(rows) ? (rows as BiostarEvent[]) : [];
}

/**
 * One sync pass: log in, pull everything since the stored cursor, feed it
 * through the same ingestPunches() pipeline ZKTeco punches go through, and
 * move the cursor. A BioStar 2 user's "User ID" field is what a worker's
 * biometricId is matched against — same convention as a ZKTeco PIN.
 */
export async function syncSupremaDevice(deviceId: string) {
  const device = await prisma.attendanceDevice.findUniqueOrThrow({ where: { id: deviceId } });
  if (device.vendor !== 'SUPREMA') {
    throw new BiostarError('Not a Suprema/BioStar 2 device');
  }

  const sessionId = await biostarLogin(device);
  const events = await fetchEventsSince(device, sessionId, device.biostarLastEventId);

  const punches: Punch[] = events
    .filter((e) => e.user_id)
    .map((e) => ({ biometricId: e.user_id!, timestamp: new Date(e.datetime) }));

  const summary = await ingestPunches(device, punches);

  if (events.length > 0) {
    const lastEventId = events[events.length - 1].ID;
    await prisma.attendanceDevice.update({
      where: { id: device.id },
      data: { biostarLastEventId: lastEventId, lastSyncAt: new Date() },
    });
  } else {
    await prisma.attendanceDevice.update({
      where: { id: device.id },
      data: { lastSyncAt: new Date() },
    });
  }

  logger.info(
    {
      deviceId: device.id,
      received: summary.received,
      accepted: summary.accepted,
      issues: summary.issues.length,
    },
    'BioStar 2 sync complete',
  );
  return summary;
}

/** Polls every active Suprema device. Errors are per-device — one bad device never blocks the rest. */
export async function syncAllSupremaDevices() {
  const devices = await prisma.attendanceDevice.findMany({
    where: { vendor: 'SUPREMA', active: true },
    select: { id: true, name: true },
  });
  for (const device of devices) {
    try {
      await syncSupremaDevice(device.id);
    } catch (err) {
      logger.error({ err, deviceId: device.id, deviceName: device.name }, 'BioStar 2 sync failed');
    }
  }
}
