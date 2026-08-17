import { Router } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { asyncHandler, ApiError } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { projectScope, requireSuperadmin } from '../middleware/rbac';
import { audit } from '../middleware/audit';

const router = Router();
router.use(requireAuth);

// A wide sanity ceiling, not a wage policy — this only exists to catch a
// fat-fingered extra zero (e.g. 2500 typed for 250), not to cap what a
// specialist can legitimately be paid. It feeds labour cost / budget health
// directly, so a typo here silently corrupts those numbers otherwise.
const MAX_HOURLY_RATE = 5000;
const hourlyRateField = z.coerce
  .number()
  .nonnegative()
  .max(
    MAX_HOURLY_RATE,
    `Hourly rate looks too high (over KES ${MAX_HOURLY_RATE.toLocaleString()}/hr) — check for an extra digit`,
  );

const workerSchema = z.object({
  name: z.string().min(1),
  phone: z.string().nullable().optional(),
  trade: z.string().min(1),
  hourlyRate: hourlyRateField,
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  biometricId: z.string().nullable().optional(),
  dateOfBirth: z.coerce.date().nullable().optional(),
});

// What a supervisor may set: roster/contact details for their own site's
// fundis. Company-wide fields (status, biometric enrollment) stay
// admin-only — status affects the whole roster, and fingerprint linking is
// centralized through the Sync Issues flow to avoid conflicting IDs.
const supervisorWorkerSchema = z.object({
  name: z.string().min(1),
  phone: z.string().nullable().optional(),
  trade: z.string().min(1),
  hourlyRate: hourlyRateField,
});

const include = {
  assignments: {
    where: { endDate: null },
    include: { project: { select: { id: true, name: true } } },
  },
} as const;

/** Is this project one the caller supervises (or any project, if admin)? */
async function assertOwnProject(userId: string, role: string, projectId: string) {
  if (role === 'SUPERADMIN') return;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { supervisorId: true },
  });
  if (!project || project.supervisorId !== userId) {
    throw ApiError.forbidden('You are not assigned to this site');
  }
}

/** Is this worker currently active on one of the caller's own sites? */
async function assertOwnWorker(userId: string, role: string, workerId: string) {
  if (role === 'SUPERADMIN') return;
  const active = await prisma.workerAssignment.findFirst({
    where: { workerId, endDate: null, project: { supervisorId: userId } },
  });
  if (!active) throw ApiError.forbidden('This fundi is not on one of your sites');
}

// Supervisors see workers currently assigned to their sites; admin sees all.
// An optional ?projectId narrows further to just that site — callers picking
// a worker for a specific project (attendance override, fundi roster) should
// always pass it, so cross-site names never leak into a single-site picker.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { projectId } = req.query;
    const scope = req.user!.role === 'SUPERADMIN' ? {} : projectScope(req.user!);
    const projectFilter = {
      ...scope,
      ...(typeof projectId === 'string' && projectId ? { id: projectId } : {}),
    };
    const where =
      Object.keys(projectFilter).length === 0
        ? {}
        : { assignments: { some: { endDate: null, project: projectFilter } } };
    res.json(await prisma.worker.findMany({ where, include, orderBy: { name: 'asc' } }));
  }),
);

// Admin: create a worker, optionally onto any project. Supervisor: create a
// fundi and place them straight onto one of their own sites (projectId
// required) — a bare, unassigned worker isn't useful from a site screen.
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const isAdmin = req.user!.role === 'SUPERADMIN';
    const { projectId, ...body } = req.body ?? {};
    const data = isAdmin ? workerSchema.parse(body) : supervisorWorkerSchema.parse(body);

    if (!isAdmin) {
      if (typeof projectId !== 'string' || !projectId) {
        throw ApiError.badRequest('projectId is required');
      }
      await assertOwnProject(req.user!.id, req.user!.role, projectId);
    }

    const worker = await prisma.$transaction(async (tx) => {
      const created = await tx.worker.create({ data });
      if (projectId) {
        await tx.workerAssignment.create({ data: { workerId: created.id, projectId } });
      }
      return tx.worker.findUniqueOrThrow({ where: { id: created.id }, include });
    });
    audit(req, 'worker.create', 'Worker', worker.id, { name: worker.name, projectId });
    res.status(201).json(worker);
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const isAdmin = req.user!.role === 'SUPERADMIN';
    await assertOwnWorker(req.user!.id, req.user!.role, req.params.id);
    const data = (isAdmin ? workerSchema : supervisorWorkerSchema).partial().parse(req.body);
    const worker = await prisma.worker.update({
      where: { id: req.params.id },
      data,
      include,
    });
    audit(req, 'worker.update', 'Worker', worker.id);
    res.json(worker);
  }),
);

// Admin-only, permanent. Worker → AttendanceRecord is onDelete: Cascade, so a
// bare delete would silently wipe labour-cost history that feeds budget
// numbers — block it explicitly rather than relying on a FK violation that
// will never fire. WorkerAssignment rows carry no financial data, so letting
// those cascade away is fine.
router.delete(
  '/:id',
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    const worker = await prisma.worker.findUniqueOrThrow({ where: { id: req.params.id } });
    const attendanceCount = await prisma.attendanceRecord.count({
      where: { workerId: worker.id },
    });
    if (attendanceCount > 0) {
      throw ApiError.conflict(
        'This fundi has attendance history (which feeds labour cost and budget records) and cannot be permanently deleted. Remove them from their site instead to preserve those records.',
      );
    }
    await prisma.worker.delete({ where: { id: worker.id } });
    audit(req, 'worker.delete', 'Worker', worker.id, { name: worker.name });
    res.json({ ok: true });
  }),
);

// ---- Bulk import from CSV/Excel — the fundi list usually already exists there ----

// In-memory only: the file is parsed and discarded, never persisted or
// linked, so it doesn't need the shared disk-based upload/signing pipeline.
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
    if (!ok) return cb(ApiError.badRequest('File must be a .csv, .xls, or .xlsx spreadsheet'));
    cb(null, true);
  },
});

const HEADER_ALIASES: Record<string, string[]> = {
  name: ['name', 'full name', 'fundi name', 'worker name'],
  phone: ['phone', 'phone number', 'mobile', 'mobile number', 'contact'],
  trade: ['trade', 'occupation', 'skill', 'role'],
  hourlyRate: ['hourly rate', 'hourlyrate', 'rate', 'hourly rate (kes)', 'rate (kes)'],
  biometricId: ['biometric id', 'biometricid', 'fingerprint id', 'device id'],
};

function normalizeRow(raw: Record<string, unknown>): Record<string, string> {
  const lowerEntries = Object.entries(raw).map(([k, v]) => [k.trim().toLowerCase(), v] as const);
  const out: Record<string, string> = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const hit = lowerEntries.find(([k]) => aliases.includes(k));
    if (hit && hit[1] != null) out[field] = String(hit[1]).trim();
  }
  return out;
}

const importRowSchema = z.object({
  name: z.string().min(1, 'name is required'),
  phone: z.string().optional(),
  trade: z.string().min(1, 'trade is required'),
  // positive (not nonnegative): an empty cell coerces to 0, which must be
  // rejected rather than silently imported as a free worker.
  hourlyRate: z.coerce
    .number()
    .positive('hourly rate is required and must be greater than 0')
    .max(
      MAX_HOURLY_RATE,
      `hourly rate over KES ${MAX_HOURLY_RATE.toLocaleString()}/hr — check for an extra digit`,
    ),
  biometricId: z.string().optional(),
});

interface ImportRowResult {
  row: number;
  name?: string;
  status: 'created' | 'error';
  warning?: string;
  error?: string;
}

router.post(
  '/import',
  requireSuperadmin,
  importUpload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.badRequest('file is required');

    let sheetRows: Record<string, unknown>[];
    try {
      const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      sheetRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    } catch {
      throw ApiError.badRequest('Could not read the file — is it a valid CSV/Excel spreadsheet?');
    }
    if (sheetRows.length === 0) throw ApiError.badRequest('The file has no data rows');
    if (sheetRows.length > 500) {
      throw ApiError.badRequest('Import is limited to 500 rows at a time');
    }

    const existingBiometricIds = new Set(
      (
        await prisma.worker.findMany({
          where: { biometricId: { not: null } },
          select: { biometricId: true },
        })
      ).map((w) => w.biometricId!),
    );
    const seenInFile = new Set<string>();

    // Phase 1: validate every row synchronously (no DB round trips yet).
    const results: ImportRowResult[] = new Array(sheetRows.length);
    const toCreate: {
      index: number;
      rowNum: number;
      data: z.infer<typeof importRowSchema>;
      biometricId: string | null;
      warning?: string;
    }[] = [];
    sheetRows.forEach((raw, i) => {
      const rowNum = i + 2; // header is row 1
      const normalized = normalizeRow(raw);
      const parsed = importRowSchema.safeParse(normalized);
      if (!parsed.success) {
        results[i] = {
          row: rowNum,
          name: normalized.name,
          status: 'error',
          error: parsed.error.issues.map((iss) => iss.message).join('; '),
        };
        return;
      }
      const data = parsed.data;
      let biometricId: string | null = data.biometricId?.trim() || null;
      let warning: string | undefined;
      if (biometricId && (existingBiometricIds.has(biometricId) || seenInFile.has(biometricId))) {
        warning = `Biometric ID "${biometricId}" is already in use — worker created without it`;
        biometricId = null;
      }
      if (biometricId) seenInFile.add(biometricId);
      toCreate.push({ index: i, rowNum, data, biometricId, warning });
    });

    // Phase 2: writes are independent, so run them with bounded concurrency
    // instead of one round trip at a time — a 500-row file no longer means
    // 500 serialized queries on one connection.
    const CONCURRENCY = 20;
    for (let start = 0; start < toCreate.length; start += CONCURRENCY) {
      const batch = toCreate.slice(start, start + CONCURRENCY);
      await Promise.all(
        batch.map(async ({ index, rowNum, data, biometricId, warning }) => {
          try {
            const worker = await prisma.worker.create({
              data: {
                name: data.name,
                phone: data.phone || null,
                trade: data.trade,
                hourlyRate: data.hourlyRate,
                biometricId,
              },
            });
            results[index] = { row: rowNum, name: worker.name, status: 'created', warning };
          } catch {
            results[index] = {
              row: rowNum,
              name: data.name,
              status: 'error',
              error: 'Could not save this row',
            };
          }
        }),
      );
    }

    const created = results.filter((r) => r.status === 'created').length;
    audit(req, 'worker.import', 'Worker', undefined, {
      totalRows: sheetRows.length,
      created,
      failed: sheetRows.length - created,
    });
    res.status(201).json({ totalRows: sheetRows.length, created, results });
  }),
);

// ---- Assignments: identity is separate from project membership ----

const assignSchema = z.object({
  projectId: z.string().min(1),
  startDate: z.coerce.date().optional(),
});

// Admin: move any worker onto any site. Supervisor: pick up an existing,
// currently-unassigned fundi onto one of their own sites — moving someone
// who's actively working another site is blocked, so a supervisor can't
// poach a fundi out from under a peer.
router.post(
  '/:id/assign',
  asyncHandler(async (req, res) => {
    const isAdmin = req.user!.role === 'SUPERADMIN';
    const { projectId, startDate } = assignSchema.parse(req.body);
    const worker = await prisma.worker.findUnique({
      where: { id: req.params.id },
      include: { assignments: { where: { endDate: null }, take: 1 } },
    });
    if (!worker) throw ApiError.notFound('Worker not found');

    if (!isAdmin) {
      await assertOwnProject(req.user!.id, req.user!.role, projectId);
      const current = worker.assignments[0];
      if (current && current.projectId !== projectId) {
        throw ApiError.conflict('This fundi is already assigned to another site');
      }
    }

    const assignment = await prisma.$transaction(async (tx) => {
      // Close any open assignment before opening a new one.
      await tx.workerAssignment.updateMany({
        where: { workerId: worker.id, endDate: null },
        data: { endDate: new Date() },
      });
      return tx.workerAssignment.create({
        data: { workerId: worker.id, projectId, startDate },
        include: { project: { select: { id: true, name: true } } },
      });
    });
    audit(req, 'worker.assign', 'Worker', worker.id, { projectId });
    res.status(201).json(assignment);
  }),
);

router.post(
  '/:id/unassign',
  asyncHandler(async (req, res) => {
    await assertOwnWorker(req.user!.id, req.user!.role, req.params.id);
    await prisma.workerAssignment.updateMany({
      where: { workerId: req.params.id, endDate: null },
      data: { endDate: new Date() },
    });
    audit(req, 'worker.unassign', 'Worker', req.params.id);
    res.json({ ok: true });
  }),
);

router.get(
  '/:id/history',
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    res.json(
      await prisma.workerAssignment.findMany({
        where: { workerId: req.params.id },
        include: { project: { select: { id: true, name: true } } },
        orderBy: { startDate: 'desc' },
      }),
    );
  }),
);

export default router;
