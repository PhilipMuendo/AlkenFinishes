import { Prisma, type AttendanceMethod, type AttendanceSource } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { logger } from '../lib/logger';

/** A day beyond this is overtime, paid at OVERTIME_MULTIPLIER. */
export const STANDARD_SHIFT_HOURS = 8;
export const OVERTIME_MULTIPLIER = 1.5;

/**
 * Hours × rate, capped at MAX_SHIFT_HOURS so a bad timestamp can't inflate
 * cost, with hours past STANDARD_SHIFT_HOURS paid at OVERTIME_MULTIPLIER.
 * Overtime is computed here rather than left for a report to derive later,
 * so labourCost — the figure finance.ts rolls into LABOUR actuals — is right
 * the moment the record is written.
 */
export function computeCost(checkIn: Date, checkOut: Date | null, hourlyRate: Prisma.Decimal) {
  if (!checkOut) return { hoursWorked: null, labourCost: null };
  const raw = (checkOut.getTime() - checkIn.getTime()) / 3_600_000;
  const hours = Math.min(Math.max(0, raw), env.MAX_SHIFT_HOURS);
  const rounded = Math.round(hours * 100) / 100;
  const regular = Math.min(rounded, STANDARD_SHIFT_HOURS);
  const overtime = rounded - regular;
  const rate = Number(hourlyRate);
  const cost = regular * rate + overtime * rate * OVERTIME_MULTIPLIER;
  return {
    hoursWorked: rounded,
    labourCost: Math.round(cost * 100) / 100,
  };
}

export interface Punch {
  biometricId: string;
  timestamp: Date;
}

export interface IngestSummary {
  accepted: number; // day-records created or updated
  received: number;
  issues: { biometricId: string; reason: string }[];
}

function dayStart(ts: Date) {
  return new Date(Date.UTC(ts.getUTCFullYear(), ts.getUTCMonth(), ts.getUTCDate()));
}
const keyOf = (workerId: string, projectId: string, date: Date) =>
  `${workerId}:${projectId}:${date.toISOString().slice(0, 10)}`;

/**
 * Turn a batch of raw fingerprint punches into attendance.
 * First punch of a worker's day is the check-in, last is the check-out —
 * robust to double-taps and missed check-outs, which are the norm on site.
 * Punches that can't be placed (unknown finger, no site) become sync issues.
 */
export async function ingestPunches(
  device: { id: string; projectId: string | null },
  punches: Punch[],
  opts: { method?: AttendanceMethod; source?: AttendanceSource } = {},
): Promise<IngestSummary> {
  const method = opts.method ?? 'FINGERPRINT';
  const source = opts.source ?? 'DEVICE_SYNC';
  const issues: { biometricId: string; reason: string; workerId?: string }[] = [];
  if (punches.length === 0) return { accepted: 0, received: 0, issues: [] };

  const bios = [...new Set(punches.map((p) => p.biometricId))];
  const workers = await prisma.worker.findMany({
    where: { biometricId: { in: bios } },
    include: { assignments: { where: { endDate: null }, take: 1 } },
  });
  const workerByBio = new Map(workers.map((w) => [w.biometricId!, w]));

  interface Agg {
    workerId: string;
    projectId: string;
    date: Date;
    min: Date;
    max: Date;
    rate: Prisma.Decimal;
  }
  const groups = new Map<string, Agg>();
  const seenIssue = new Set<string>();
  const pushIssue = (biometricId: string, reason: string, workerId?: string) => {
    const k = `${biometricId}:${reason}`;
    if (seenIssue.has(k)) return;
    seenIssue.add(k);
    issues.push({ biometricId, reason, workerId });
  };

  for (const p of punches) {
    const worker = workerByBio.get(p.biometricId);
    if (!worker) {
      pushIssue(p.biometricId, 'unknown_worker');
      continue;
    }
    const projectId = device.projectId ?? worker.assignments[0]?.projectId;
    if (!projectId) {
      pushIssue(p.biometricId, 'no_assignment', worker.id);
      continue;
    }
    if (device.projectId && projectId !== device.projectId) {
      pushIssue(p.biometricId, 'wrong_site', worker.id);
      continue;
    }
    const date = dayStart(p.timestamp);
    const k = keyOf(worker.id, projectId, date);
    const g = groups.get(k);
    if (!g) {
      groups.set(k, {
        workerId: worker.id,
        projectId,
        date,
        min: p.timestamp,
        max: p.timestamp,
        rate: worker.hourlyRate,
      });
    } else {
      if (p.timestamp < g.min) g.min = p.timestamp;
      if (p.timestamp > g.max) g.max = p.timestamp;
    }
  }

  if (groups.size > 0) {
    const existing = await prisma.attendanceRecord.findMany({
      where: {
        OR: [...groups.values()].map((g) => ({
          workerId: g.workerId,
          projectId: g.projectId,
          date: g.date,
        })),
      },
      select: { id: true, workerId: true, projectId: true, date: true, checkIn: true, checkOut: true },
    });
    const exByKey = new Map(existing.map((e) => [keyOf(e.workerId, e.projectId, e.date), e]));

    const ops: Prisma.PrismaPromise<unknown>[] = [];
    for (const [k, g] of groups) {
      const ex = exByKey.get(k);
      const checkIn = ex && ex.checkIn < g.min ? ex.checkIn : g.min;
      let last = g.max;
      if (ex?.checkOut && ex.checkOut > last) last = ex.checkOut;
      const checkOut = last > checkIn ? last : null;
      const cost = computeCost(checkIn, checkOut, g.rate);
      if (ex) {
        ops.push(
          prisma.attendanceRecord.update({ where: { id: ex.id }, data: { checkIn, checkOut, ...cost } }),
        );
      } else {
        ops.push(
          prisma.attendanceRecord.create({
            data: {
              workerId: g.workerId,
              projectId: g.projectId,
              date: g.date,
              checkIn,
              checkOut,
              deviceId: device.id,
              method,
              source,
              ...cost,
            },
          }),
        );
      }
    }
    await prisma.$transaction(ops);
  }

  await Promise.all(issues.map((i) => recordIssue(device.id, i.biometricId, i.reason, i.workerId)));
  await prisma.attendanceDevice
    .update({ where: { id: device.id }, data: { lastSyncAt: new Date() } })
    .catch((e) => logger.warn({ err: e }, 'device lastSyncAt update failed'));

  return { accepted: groups.size, received: punches.length, issues: issues.map(({ biometricId, reason }) => ({ biometricId, reason })) };
}

/** Dedupe-record a punch we couldn't place, so the admin can act on it. */
export async function recordIssue(
  deviceId: string,
  biometricId: string,
  reason: string,
  workerId?: string,
  detail?: string,
) {
  await prisma.attendanceSyncIssue.upsert({
    where: { deviceId_biometricId_reason: { deviceId, biometricId, reason } },
    create: { deviceId, biometricId, reason, workerId, detail },
    update: {
      occurrences: { increment: 1 },
      lastSeenAt: new Date(),
      resolvedAt: null,
      ...(workerId ? { workerId } : {}),
    },
  });
}
