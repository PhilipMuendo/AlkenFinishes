import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { asyncHandler, ApiError } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { requireProjectAccess, requireSuperadmin } from '../middleware/rbac';
import { audit } from '../middleware/audit';
import { deviceSyncLimiter } from '../middleware/rateLimit';
import { computeCost, recordIssue } from '../services/attendanceIngest';

/**
 * Attendance design:
 * - Primary source is portable fingerprint devices pushing idempotent batches
 *   (idempotency scoped per device: unique (deviceId, externalId)). A device
 *   may be bound to one site; its records cannot land elsewhere.
 * - Supervisors cannot create ordinary records. MANUAL_OVERRIDE is restricted
 *   to workers currently assigned to the site, flagged, and audit-logged.
 * - Hours are capped (MAX_SHIFT_HOURS) and check-out uses the server clock —
 *   timestamps that inflate labour cost are rejected everywhere.
 */

const recordSchema = z.object({
  biometricId: z.string().min(1),
  date: z.coerce.date(),
  checkIn: z.coerce.date(),
  checkOut: z.coerce.date().nullable().optional(),
  externalId: z.string().min(1),
  projectId: z.string().optional(), // defaults to worker's current assignment
});

const syncSchema = z.object({
  deviceId: z.string().min(1),
  records: z.array(recordSchema).max(2000),
});

export const deviceRouter = Router();

// Device-facing endpoint: API-key auth, not user JWT.
deviceRouter.post(
  '/device-sync',
  deviceSyncLimiter,
  asyncHandler(async (req, res) => {
    const apiKey = req.headers['x-device-key'];
    if (typeof apiKey !== 'string' || !apiKey) throw ApiError.unauthorized('Missing device key');
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    const device = await prisma.attendanceDevice.findUnique({ where: { apiKeyHash: keyHash } });
    if (!device || !device.active) throw ApiError.unauthorized('Unknown or disabled device');

    const { deviceId, records } = syncSchema.parse(req.body);
    const results: { externalId: string; status: string }[] = [];
    // Punches we couldn't place, deduped, for the admin's Sync Issues view.
    const issuesToRecord = new Map<string, { biometricId: string; reason: string; workerId?: string }>();
    const flagIssue = (biometricId: string, reason: string, workerId?: string) =>
      issuesToRecord.set(`${biometricId}:${reason}`, { biometricId, reason, workerId });

    // Batch-fetch everything the loop needs: workers, existing sync records,
    // and existing same-day records — three queries instead of N per record.
    const [workers, existing] = await Promise.all([
      prisma.worker.findMany({
        where: { biometricId: { in: records.map((r) => r.biometricId) } },
        include: { assignments: { where: { endDate: null }, take: 1 } },
      }),
      prisma.attendanceRecord.findMany({
        where: { deviceId, externalId: { in: records.map((r) => r.externalId) } },
        select: { id: true, externalId: true, checkOut: true, workerId: true },
      }),
    ]);
    const workerByBio = new Map(workers.map((w) => [w.biometricId!, w]));
    const existingByExt = new Map(existing.map((e) => [e.externalId!, e]));

    const sameDay = await prisma.attendanceRecord.findMany({
      where: {
        workerId: { in: workers.map((w) => w.id) },
        date: { in: records.map((r) => r.date) },
      },
      select: { workerId: true, projectId: true, date: true, externalId: true, deviceId: true },
    });
    const dayKey = (workerId: string, projectId: string, date: Date) =>
      `${workerId}:${projectId}:${date.toISOString().slice(0, 10)}`;
    const sameDaySet = new Map(sameDay.map((r) => [dayKey(r.workerId, r.projectId, r.date), r]));

    const creates: Prisma.AttendanceRecordCreateManyInput[] = [];
    const updates: { id: string; data: Prisma.AttendanceRecordUpdateInput }[] = [];

    for (const rec of records) {
      const worker = workerByBio.get(rec.biometricId);
      if (!worker) {
        results.push({ externalId: rec.externalId, status: 'unknown_worker' });
        flagIssue(rec.biometricId, 'unknown_worker');
        continue;
      }
      const projectId = rec.projectId ?? device.projectId ?? worker.assignments[0]?.projectId;
      if (!projectId) {
        results.push({ externalId: rec.externalId, status: 'no_assignment' });
        flagIssue(rec.biometricId, 'no_assignment', worker.id);
        continue;
      }
      if (device.projectId && projectId !== device.projectId) {
        results.push({ externalId: rec.externalId, status: 'wrong_site_for_device' });
        flagIssue(rec.biometricId, 'wrong_site', worker.id);
        continue;
      }
      const checkOut = rec.checkOut ?? null;
      if (checkOut && checkOut <= rec.checkIn) {
        results.push({ externalId: rec.externalId, status: 'invalid_times' });
        continue;
      }
      const cost = computeCost(rec.checkIn, checkOut, worker.hourlyRate);

      const prior = existingByExt.get(rec.externalId);
      if (prior) {
        // Idempotent re-upload; only fill in a missing check-out.
        if (!prior.checkOut && checkOut) {
          updates.push({ id: prior.id, data: { checkOut, ...cost } });
          results.push({ externalId: rec.externalId, status: 'updated' });
        } else {
          results.push({ externalId: rec.externalId, status: 'ok' });
        }
        continue;
      }
      const clash = sameDaySet.get(dayKey(worker.id, projectId, rec.date));
      if (clash) {
        results.push({ externalId: rec.externalId, status: 'duplicate_day' });
        continue;
      }
      sameDaySet.set(dayKey(worker.id, projectId, rec.date), {
        workerId: worker.id,
        projectId,
        date: rec.date,
        externalId: rec.externalId,
        deviceId,
      });
      creates.push({
        workerId: worker.id,
        projectId,
        date: rec.date,
        checkIn: rec.checkIn,
        checkOut,
        deviceId,
        method: 'FINGERPRINT',
        source: 'DEVICE_SYNC',
        externalId: rec.externalId,
        ...cost,
      });
      results.push({ externalId: rec.externalId, status: 'ok' });
    }

    await prisma.$transaction([
      ...(creates.length
        ? [prisma.attendanceRecord.createMany({ data: creates, skipDuplicates: true })]
        : []),
      ...updates.map((u) => prisma.attendanceRecord.update({ where: { id: u.id }, data: u.data })),
      prisma.attendanceDevice.update({
        where: { id: device.id },
        data: { lastSyncAt: new Date() },
      }),
    ]);

    await Promise.all(
      [...issuesToRecord.values()].map((i) =>
        recordIssue(device.id, i.biometricId, i.reason, i.workerId),
      ),
    );

    res.json({ received: records.length, results });
  }),
);

// Project-scoped attendance for the app.
const router = Router({ mergeParams: true });
router.use(requireAuth, requireProjectAccess);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { from, to } = z
      .object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() })
      .parse(req.query);
    // Default window keeps the payload bounded as history grows.
    const effectiveFrom = from ?? (to ? undefined : new Date(Date.now() - 31 * 86400_000));
    res.json(
      await prisma.attendanceRecord.findMany({
        where: {
          projectId: req.params.projectId,
          date: {
            ...(effectiveFrom && { gte: effectiveFrom }),
            ...(to && { lte: to }),
          },
        },
        include: {
          worker: { select: { id: true, name: true, trade: true, hourlyRate: true } },
          recordedBy: { select: { id: true, name: true } },
        },
        orderBy: [{ date: 'desc' }, { checkIn: 'asc' }],
        take: 1000,
      }),
    );
  }),
);

const overrideSchema = z.object({
  workerId: z.string().min(1),
  date: z.coerce.date(),
  checkIn: z.coerce.date(),
  checkOut: z.coerce.date().nullable().optional(),
  reason: z.string().min(3),
});

// Exceptional manual entry — flagged and audited, never the primary flow.
router.post(
  '/manual-override',
  asyncHandler(async (req, res) => {
    const data = overrideSchema.parse(req.body);
    if (data.checkOut && data.checkOut <= data.checkIn) {
      throw ApiError.badRequest('Check-out must be after check-in');
    }
    const worker = await prisma.worker.findUniqueOrThrow({
      where: { id: data.workerId },
      include: {
        assignments: { where: { endDate: null, projectId: req.params.projectId }, take: 1 },
      },
    });
    if (worker.assignments.length === 0) {
      throw ApiError.badRequest('Worker is not currently assigned to this site');
    }
    const cost = computeCost(data.checkIn, data.checkOut ?? null, worker.hourlyRate);
    const record = await prisma.attendanceRecord.create({
      data: {
        workerId: worker.id,
        projectId: req.params.projectId,
        date: data.date,
        checkIn: data.checkIn,
        checkOut: data.checkOut ?? null,
        method: 'MANUAL_OVERRIDE',
        source: 'MANUAL',
        recordedById: req.user!.id,
        ...cost,
      },
    });
    audit(req, 'attendance.manual_override', 'AttendanceRecord', record.id, {
      workerId: worker.id,
      reason: data.reason,
    });
    res.status(201).json(record);
  }),
);

// Close an open record. Server clock only — clients cannot choose the time.
router.post(
  '/:id/checkout',
  asyncHandler(async (req, res) => {
    const record = await prisma.attendanceRecord.findUnique({
      where: { id: req.params.id },
      include: { worker: true },
    });
    if (!record || record.projectId !== req.params.projectId) throw ApiError.notFound();
    if (record.checkOut) throw ApiError.conflict('Record is already checked out');
    const checkOut = new Date();
    if (checkOut <= record.checkIn) throw ApiError.badRequest('Check-out precedes check-in');
    const cost = computeCost(record.checkIn, checkOut, record.worker.hourlyRate);
    const updated = await prisma.attendanceRecord.update({
      where: { id: record.id },
      data: { checkOut, ...cost },
    });
    audit(req, 'attendance.checkout', 'AttendanceRecord', record.id);
    res.json(updated);
  }),
);

// ---- Device management (admin) ----
export const adminDeviceRouter = Router();
adminDeviceRouter.use(requireAuth, requireSuperadmin);

adminDeviceRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json(
      await prisma.attendanceDevice.findMany({
        select: {
          id: true,
          name: true,
          active: true,
          projectId: true,
          serialNumber: true,
          lastSyncAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }),
);

adminDeviceRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { name, projectId, serialNumber } = z
      .object({
        name: z.string().min(1),
        projectId: z.string().nullable().optional(),
        // ZKTeco/ADMS push devices identify by serial number.
        serialNumber: z.string().trim().min(1).optional(),
      })
      .parse(req.body);
    const apiKey = crypto.randomBytes(32).toString('hex');
    const device = await prisma.attendanceDevice.create({
      data: {
        name,
        projectId: projectId ?? null,
        serialNumber: serialNumber ?? null,
        apiKeyHash: crypto.createHash('sha256').update(apiKey).digest('hex'),
      },
    });
    audit(req, 'device.create', 'AttendanceDevice', device.id, { name, projectId, serialNumber });
    // The plaintext key is returned exactly once.
    res.status(201).json({ id: device.id, name: device.name, apiKey });
  }),
);

adminDeviceRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const data = z
      .object({
        active: z.boolean().optional(),
        projectId: z.string().nullable().optional(),
        serialNumber: z.string().trim().min(1).nullable().optional(),
      })
      .parse(req.body);
    const device = await prisma.attendanceDevice.update({
      where: { id: req.params.id },
      data,
      select: { id: true, name: true, active: true, projectId: true, serialNumber: true },
    });
    audit(req, 'device.update', 'AttendanceDevice', device.id, data);
    res.json(device);
  }),
);

// ---- Sync issues: punches that couldn't become attendance ----

adminDeviceRouter.get(
  '/issues',
  asyncHandler(async (req, res) => {
    const { resolved } = z
      .object({ resolved: z.enum(['true', 'false']).optional() })
      .parse(req.query);
    const issues = await prisma.attendanceSyncIssue.findMany({
      where: { resolvedAt: resolved === 'true' ? { not: null } : null },
      include: { worker: { select: { id: true, name: true, trade: true } } },
      orderBy: { lastSeenAt: 'desc' },
      take: 200,
    });
    res.json(issues);
  }),
);

adminDeviceRouter.post(
  '/issues/:id/resolve',
  asyncHandler(async (req, res) => {
    const issue = await prisma.attendanceSyncIssue.update({
      where: { id: req.params.id },
      data: { resolvedAt: new Date() },
    });
    audit(req, 'attendance.issue_resolve', 'AttendanceSyncIssue', issue.id);
    res.json(issue);
  }),
);

// Enroll: bind an unrecognised fingerprint id to a worker, then clear the issue.
adminDeviceRouter.post(
  '/issues/:id/link',
  asyncHandler(async (req, res) => {
    const { workerId } = z.object({ workerId: z.string().min(1) }).parse(req.body);
    const issue = await prisma.attendanceSyncIssue.findUniqueOrThrow({
      where: { id: req.params.id },
    });
    const clash = await prisma.worker.findFirst({
      where: { biometricId: issue.biometricId, NOT: { id: workerId } },
      select: { id: true, name: true },
    });
    if (clash) {
      throw ApiError.conflict(`Fingerprint ID is already assigned to ${clash.name}`);
    }
    await prisma.$transaction([
      prisma.worker.update({ where: { id: workerId }, data: { biometricId: issue.biometricId } }),
      prisma.attendanceSyncIssue.update({
        where: { id: issue.id },
        data: { resolvedAt: new Date(), workerId },
      }),
    ]);
    audit(req, 'worker.enroll', 'Worker', workerId, { biometricId: issue.biometricId });
    res.json({ ok: true });
  }),
);

export default router;
