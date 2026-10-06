/**
 * Pure rules for turning a raw fingerprint punch into a (site, day) — kept free
 * of prisma/env imports so they are unit-testable and safe to import anywhere.
 */

const DEVICE_STAMP = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;

/** How far `timeZone` is ahead of UTC at `instant`, in ms. */
function offsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * A terminal stamps punches with its own wall-clock ("2026-09-28 07:30:00"),
 * which is the site's local time — not UTC. Reading it as UTC (the old
 * behaviour) stored a 07:30 punch as 07:30Z, i.e. 10:30 in Nairobi, which made
 * every device check-in look three hours late. Returns null for anything that
 * is not a real calendar time.
 */
export function parseDeviceTimestamp(raw: string, timeZone: string): Date | null {
  const m = DEVICE_STAMP.exec(raw.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = [m[1], m[2], m[3], m[4], m[5]].map(Number);
  const s = m[6] ? Number(m[6]) : 0;
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  const check = new Date(wall);
  // Date.UTC rolls 2026-13-45 over silently — reject anything that doesn't round-trip.
  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() !== mo - 1 ||
    check.getUTCDate() !== d ||
    check.getUTCHours() !== h ||
    check.getUTCMinutes() !== mi
  ) {
    return null;
  }
  // Two passes so a zone with DST resolves the offset at the right instant.
  const first = wall - offsetMs(new Date(wall), timeZone);
  return new Date(wall - offsetMs(new Date(first), timeZone));
}

/**
 * The calendar day a punch belongs to *on site*, as UTC midnight (the shape of
 * AttendanceRecord.date). Bucketing by UTC day would file a 00:30 Nairobi punch
 * under the previous day.
 */
export function localDayStart(ts: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(ts);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  return new Date(Date.UTC(n('year'), n('month') - 1, n('day')));
}

export type SitePlacement =
  | { ok: true; projectId: string }
  | { ok: false; reason: 'no_assignment' | 'wrong_site' };

/**
 * Where a recognised worker's punch lands. A worker must currently be assigned
 * to a site; and if the terminal is bound to a site, that must be their site.
 * (Previously a bound device overwrote the lookup with its own site, so the
 * wrong-site check compared the device with itself and could never fire — a
 * fundi from Site B tapping in at Site A had their cost booked to A.)
 */
export function resolvePunchSite(
  device: { projectId: string | null },
  assignedProjectId: string | null | undefined,
): SitePlacement {
  if (!assignedProjectId) return { ok: false, reason: 'no_assignment' };
  if (device.projectId && device.projectId !== assignedProjectId) {
    return { ok: false, reason: 'wrong_site' };
  }
  return { ok: true, projectId: assignedProjectId };
}
