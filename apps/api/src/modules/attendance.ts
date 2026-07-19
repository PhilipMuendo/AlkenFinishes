import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { asyncHandler, ApiError } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { requireProjectAccess, requireSuperadmin } from '../middleware/rbac';
import { audit } from '../middleware/audit';

/**
 * Attendance design:
 * - Primary source is portable fingerprint devices. Devices (or a bridge app)
 *   push batches to POST /api/v1/attendance/device-sync authenticated with a
 *   per-device API key. Records carry an externalId making the sync idempotent
 *   and safe for offline devices that re-upload after reconnecting.
 * - Supervisors cannot create ordinary records. A MANUAL_OVERRIDE endpoint
 *   exists for exceptional cases (device failure); it is flagged, attributed,
 *   and audit-logged so the owner can review every manual entry.
 * - Labour cost is computed at check-out: hours × the worker's rate at that time.
 */

function computeCost(checkIn: Date, checkOut: Date | null, hourlyRate: Prisma.Decimal) {
  if (!checkOut) return { hoursWorked: null, labourCost: null };
  const hours = Math.max(0, (checkOut.getTime() - checkIn.getTime()) / 3_600_000);
  const rounded = Math.round(hours * 100) / 100;
  return {
    hoursWorked: rounded,
    labourCost: Math.round(rounded * Number(hourlyRate) * 100) / 100,
  };
}

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
  asyncHandler(async (req, res) => {
    const apiKey = req.headers['x-device-key'];
    if (typeof apiKey !== 'string' || !apiKey) throw ApiError.unauthorized('Missing device key');
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    const device = await prisma.attendanceDevice.findUnique({ where: { apiKeyHash: keyHash } });
    if (!device || !device.active) throw ApiError.unauthorized('Unknown or disabled device');

    const { deviceId, records } = syncSchema.parse(req.body);
    const results: { externalId: string; status: string }[] = [];

    for (const rec of records) {
      const worker = await prisma.worker.findUnique({
        where: { biometricId: rec.biometricId },
        include: { assignments: { where: { endDate: null }, take: 1 } },
      });
      if (!worker) {
        results.push({ externalId: rec.externalId, status: 'unknown_worker' });
        continue;
      }
      const projectId = rec.projectId ?? worker.assignments[0]?.projectId;
      if (!projectId) {
        results.push({ externalId: rec.externalId, status: 'no_assignment' });
        continue;
      }
      const checkOut = rec.checkOut ?? null;
      const cost = computeCost(rec.checkIn, checkOut, worker.hourlyRate);
      try {
        await prisma.attendanceRecord.upsert({
          where: { externalId: rec.externalId },
          create: {
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
          },
          update: { checkOut, ...cost },
        });
        results.push({ externalId: rec.externalId, status: 'ok' });
      } catch {
        results.push({ externalId: rec.externalId, status: 'duplicate_day' });
      }
    }

    await prisma.attendanceDevice.update({
      where: { id: device.id },
      data: { lastSyncAt: new Date() },
    });
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
    res.json(
      await prisma.attendanceRecord.findMany({
        where: {
          projectId: req.params.projectId,
          ...(from || to ? { date: { ...(from && { gte: from }), ...(to && { lte: to }) } } : {}),
        },
        include: {
          worker: { select: { id: true, name: true, trade: true, hourlyRate: true } },
          recordedBy: { select: { id: true, name: true } },
        },
        orderBy: [{ date: 'desc' }, { checkIn: 'asc' }],
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
    const worker = await prisma.worker.findUniqueOrThrow({ where: { id: data.workerId } });
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

// Close an open record (checkout).
router.post(
  '/:id/checkout',
  asyncHandler(async (req, res) => {
    const { checkOut } = z.object({ checkOut: z.coerce.date() }).parse(req.body);
    const record = await prisma.attendanceRecord.findUnique({
      where: { id: req.params.id },
      include: { worker: true },
    });
    if (!record || record.projectId !== req.params.projectId) throw ApiError.notFound();
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
        select: { id: true, name: true, active: true, lastSyncAt: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }),
);

adminDeviceRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { name } = z.object({ name: z.string().min(1) }).parse(req.body);
    const apiKey = crypto.randomBytes(32).toString('hex');
    const device = await prisma.attendanceDevice.create({
      data: { name, apiKeyHash: crypto.createHash('sha256').update(apiKey).digest('hex') },
    });
    audit(req, 'device.create', 'AttendanceDevice', device.id, { name });
    // The plaintext key is returned exactly once.
    res.status(201).json({ id: device.id, name: device.name, apiKey });
  }),
);

adminDeviceRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { active } = z.object({ active: z.boolean() }).parse(req.body);
    const device = await prisma.attendanceDevice.update({
      where: { id: req.params.id },
      data: { active },
      select: { id: true, name: true, active: true },
    });
    audit(req, 'device.update', 'AttendanceDevice', device.id, { active });
    res.json(device);
  }),
);

export default router;
