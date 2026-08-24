import { Router } from 'express';
import crypto from 'crypto';
import multer from 'multer';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { asyncHandler, ApiError } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { requireProjectAccess, requireSuperadmin } from '../middleware/rbac';
import { audit } from '../middleware/audit';
import { visibleAttendanceList } from '../services/payVisibility';
import { deviceSyncLimiter } from '../middleware/rateLimit';
import { computeCost, ingestPunches, recordIssue } from '../services/attendanceIngest';
import { encrypt } from '../services/crypto';
import { BiostarError, syncSupremaDevice } from '../services/biostar';
import { CsvImportError, parsePunchFile, type ParsedImport } from '../services/csvImport';

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
    const records = await prisma.attendanceRecord.findMany({
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
    });
    // A supervisor sees who was on site and for how long, not what it cost.
    // `labourCost` divided by hours is the pay rate, so stripping the rate and
    // leaving the cost would be a boundary in name only.
    res.json(visibleAttendanceList(records, req.user!.role));
  }),
);

/** Great-circle distance in metres — Haversine, accurate enough for a site geofence. */
function distanceMetres(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const overrideRequestSchema = z.object({
  workerId: z.string().min(1),
  date: z.coerce.date(),
  checkIn: z.coerce.date(),
  checkOut: z.coerce.date().nullable().optional(),
  reason: z.string().min(3),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
});

/**
 * The only path to a manually-entered attendance record. A supervisor can no
 * longer write AttendanceRecord directly — see the schema comment on
 * AttendanceOverrideRequest for why. This endpoint only files the request; a
 * superadmin decides via POST /override-requests/:id/decision.
 */
router.post(
  '/override-requests',
  asyncHandler(async (req, res) => {
    const data = overrideRequestSchema.parse(req.body);
    if (data.checkOut && data.checkOut <= data.checkIn) {
      throw ApiError.badRequest('Check-out must be after check-in');
    }
    const [worker, project] = await Promise.all([
      prisma.worker.findUniqueOrThrow({
        where: { id: data.workerId },
        include: {
          assignments: { where: { endDate: null, projectId: req.params.projectId }, take: 1 },
        },
      }),
      prisma.project.findUniqueOrThrow({
        where: { id: req.params.projectId },
        select: { geofenceLat: true, geofenceLng: true, geofenceRadiusM: true },
      }),
    ]);
    if (worker.assignments.length === 0) {
      throw ApiError.badRequest('Worker is not currently assigned to this site');
    }

    let withinGeofence: boolean | null = null;
    if (
      project.geofenceLat != null &&
      project.geofenceLng != null &&
      project.geofenceRadiusM != null &&
      data.latitude != null &&
      data.longitude != null
    ) {
      const d = distanceMetres(
        Number(project.geofenceLat),
        Number(project.geofenceLng),
        data.latitude,
        data.longitude,
      );
      withinGeofence = d <= project.geofenceRadiusM;
    }

    const request = await prisma.attendanceOverrideRequest.create({
      data: {
        projectId: req.params.projectId,
        workerId: worker.id,
        date: data.date,
        checkIn: data.checkIn,
        checkOut: data.checkOut ?? null,
        reason: data.reason,
        latitude: data.latitude,
        longitude: data.longitude,
        withinGeofence,
        requestedById: req.user!.id,
      },
      include: {
        worker: { select: { id: true, name: true, trade: true } },
        requestedBy: { select: { id: true, name: true } },
      },
    });
    audit(req, 'attendance.override_request', 'AttendanceOverrideRequest', request.id, {
      workerId: worker.id,
      withinGeofence,
    });
    res.status(201).json(request);
  }),
);

router.get(
  '/override-requests',
  asyncHandler(async (req, res) => {
    const { status } = z
      .object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional() })
      .parse(req.query);
    const requests = await prisma.attendanceOverrideRequest.findMany({
      where: { projectId: req.params.projectId, ...(status && { status }) },
      include: {
        worker: { select: { id: true, name: true, trade: true } },
        requestedBy: { select: { id: true, name: true } },
        decidedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json(requests);
  }),
);

router.post(
  '/override-requests/:id/decision',
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    const { outcome, reason } = z
      .object({ outcome: z.enum(['APPROVED', 'REJECTED']), reason: z.string().optional() })
      .parse(req.body);
    const existing = await prisma.attendanceOverrideRequest.findUnique({
      where: { id: req.params.id },
      include: { worker: true },
    });
    if (!existing || existing.projectId !== req.params.projectId) throw ApiError.notFound();
    if (existing.status !== 'PENDING') {
      throw ApiError.conflict(`This request has already been ${existing.status.toLowerCase()}`);
    }
    if (outcome === 'REJECTED' && !reason?.trim()) {
      throw ApiError.badRequest('Say why this override was declined');
    }

    if (outcome === 'REJECTED') {
      const rejected = await prisma.attendanceOverrideRequest.update({
        where: { id: existing.id },
        data: {
          status: 'REJECTED',
          decidedById: req.user!.id,
          decidedAt: new Date(),
          rejectReason: reason,
        },
      });
      audit(req, 'attendance.override_reject', 'AttendanceOverrideRequest', rejected.id, { reason });
      return res.json(rejected);
    }

    const cost = computeCost(existing.checkIn, existing.checkOut, existing.worker.hourlyRate);
    const [record, request] = await prisma.$transaction([
      prisma.attendanceRecord.create({
        data: {
          workerId: existing.workerId,
          projectId: existing.projectId,
          date: existing.date,
          checkIn: existing.checkIn,
          checkOut: existing.checkOut,
          method: 'MANUAL_OVERRIDE',
          source: 'MANUAL',
          recordedById: req.user!.id,
          ...cost,
        },
      }),
      prisma.attendanceOverrideRequest.update({
        where: { id: existing.id },
        data: { status: 'APPROVED', decidedById: req.user!.id, decidedAt: new Date() },
      }),
    ]);
    await prisma.attendanceOverrideRequest.update({
      where: { id: request.id },
      data: { resultingRecordId: record.id },
    });
    audit(req, 'attendance.override_approve', 'AttendanceOverrideRequest', request.id, {
      workerId: existing.workerId,
      recordId: record.id,
    });
    res.json({ ...request, resultingRecordId: record.id });
  }),
);

// Close an open record. Server clock only — clients cannot choose the time.
// Superadmin-only: closing a record still changes hoursWorked and labourCost,
// and "supervisors locked out of editing hours" covers this the same as an
// override.
router.post(
  '/:id/checkout',
  requireSuperadmin,
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

// Never includes biostarPasswordEnc — that column exists to be decrypted for
// login, never to be read back out over the API.
const deviceSelect = {
  id: true,
  name: true,
  vendor: true,
  active: true,
  projectId: true,
  serialNumber: true,
  lastSyncAt: true,
  createdAt: true,
  biostarBaseUrl: true,
  biostarLoginId: true,
  biostarDeviceId: true,
  biostarInsecureTls: true,
} as const;

adminDeviceRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json(
      await prisma.attendanceDevice.findMany({ select: deviceSelect, orderBy: { createdAt: 'desc' } }),
    );
  }),
);

const biostarFieldsSchema = z.object({
  biostarBaseUrl: z.string().url().optional(),
  biostarLoginId: z.string().trim().min(1).optional(),
  biostarPassword: z.string().min(1).optional(), // plaintext in; encrypted before storage
  biostarDeviceId: z.string().trim().min(1).optional(),
  biostarInsecureTls: z.boolean().optional(),
});

adminDeviceRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { name, projectId, serialNumber, vendor, ...biostar } = z
      .object({
        name: z.string().min(1),
        projectId: z.string().nullable().optional(),
        vendor: z.enum(['ZKTECO', 'SUPREMA', 'UATTEND']).default('ZKTECO'),
        // ZKTeco/ADMS push devices identify by serial number; also used to
        // note a uAttend device's own serial for reference (not for auth).
        serialNumber: z.string().trim().min(1).optional(),
      })
      .and(biostarFieldsSchema)
      .parse(req.body);

    if (vendor === 'SUPREMA' && (!biostar.biostarBaseUrl || !biostar.biostarLoginId || !biostar.biostarPassword)) {
      throw ApiError.badRequest('A Suprema device needs the BioStar 2 server address, login and password');
    }

    const apiKey = crypto.randomBytes(32).toString('hex');
    const device = await prisma.attendanceDevice.create({
      data: {
        name,
        vendor,
        projectId: projectId ?? null,
        serialNumber: serialNumber ?? null,
        apiKeyHash: crypto.createHash('sha256').update(apiKey).digest('hex'),
        biostarBaseUrl: biostar.biostarBaseUrl,
        biostarLoginId: biostar.biostarLoginId,
        biostarPasswordEnc: biostar.biostarPassword ? encrypt(biostar.biostarPassword) : undefined,
        biostarDeviceId: biostar.biostarDeviceId,
        biostarInsecureTls: biostar.biostarInsecureTls ?? false,
      },
    });
    audit(req, 'device.create', 'AttendanceDevice', device.id, { name, vendor, projectId, serialNumber });
    // The plaintext API key is returned exactly once — ZKTeco's bridge auth
    // path only, unused by a Suprema device but harmless to hand back.
    res.status(201).json({ id: device.id, name: device.name, vendor: device.vendor, apiKey });
  }),
);

adminDeviceRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { active, projectId, serialNumber, ...biostar } = z
      .object({
        active: z.boolean().optional(),
        projectId: z.string().nullable().optional(),
        serialNumber: z.string().trim().min(1).nullable().optional(),
      })
      .and(biostarFieldsSchema)
      .parse(req.body);
    const device = await prisma.attendanceDevice.update({
      where: { id: req.params.id },
      data: {
        active,
        projectId,
        serialNumber,
        biostarBaseUrl: biostar.biostarBaseUrl,
        biostarLoginId: biostar.biostarLoginId,
        // Only overwritten when a new password is actually sent — omitting it
        // on every routine edit (e.g. just re-binding the site) must not wipe
        // stored credentials.
        ...(biostar.biostarPassword && { biostarPasswordEnc: encrypt(biostar.biostarPassword) }),
        biostarDeviceId: biostar.biostarDeviceId,
        biostarInsecureTls: biostar.biostarInsecureTls,
      },
      select: deviceSelect,
    });
    audit(req, 'device.update', 'AttendanceDevice', device.id, { active, projectId, serialNumber });
    res.json(device);
  }),
);

/** Manual, on-demand pull from BioStar 2 — the scheduled poll runs this same path automatically. */
adminDeviceRouter.post(
  '/:id/sync',
  asyncHandler(async (req, res) => {
    const device = await prisma.attendanceDevice.findUnique({ where: { id: req.params.id } });
    if (!device) throw ApiError.notFound();
    if (device.vendor !== 'SUPREMA') {
      throw ApiError.badRequest('Only Suprema/BioStar 2 devices are synced this way — ZKTeco devices push on their own');
    }
    const summary = await syncSupremaDevice(device.id).catch((err) => {
      if (err instanceof BiostarError) throw ApiError.badGateway(err.message);
      throw err;
    });
    audit(req, 'device.sync', 'AttendanceDevice', device.id, {
      received: summary.received,
      accepted: summary.accepted,
    });
    res.json(summary);
  }),
);

// ---- CSV import: for a device that can't push or be polled (uAttend) ----

// In-memory only: the file is parsed and discarded, never persisted or
// linked, the same as the worker bulk-import in modules/workers.ts.
const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok =
      /\.(csv|xlsx|xls)$/i.test(file.originalname) ||
      [
        'text/csv',
        'application/csv',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ].includes(file.mimetype);
    if (!ok) return cb(ApiError.badRequest('File must be a .csv, .xls, or .xlsx export'));
    cb(null, true);
  },
});

/**
 * Punches from a uAttend (or similar cloud-only) clock's exported report.
 * Goes through the exact same ingestPunches() pipeline ZKTeco and Suprema
 * punches do — first-in/last-out aggregation, sync-issue recording, the lot —
 * so a manually-imported punch behaves identically to a device-pushed one,
 * just tagged AttendanceSource.IMPORT so it's distinguishable in the record.
 */
adminDeviceRouter.post(
  '/:id/import',
  importUpload.single('file'),
  asyncHandler(async (req, res) => {
    const device = await prisma.attendanceDevice.findUnique({ where: { id: req.params.id } });
    if (!device) throw ApiError.notFound();
    if (device.vendor !== 'UATTEND') {
      throw ApiError.badRequest('Only a uAttend-vendor device accepts a CSV import — the other vendors sync automatically');
    }
    if (!req.file) throw ApiError.badRequest('file is required');

    let parsed: ParsedImport;
    try {
      parsed = parsePunchFile(req.file.buffer);
    } catch (err) {
      if (err instanceof CsvImportError) throw ApiError.badRequest(err.message);
      throw err;
    }
    const { punches, rowIssues } = parsed;
    const summary = await ingestPunches(device, punches, { source: 'IMPORT' });

    audit(req, 'device.import', 'AttendanceDevice', device.id, {
      rows: punches.length + rowIssues.length,
      accepted: summary.accepted,
      unplaced: summary.issues.length,
      unreadable: rowIssues.length,
    });
    res.json({ ...summary, rowIssues });
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
