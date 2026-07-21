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

const workerSchema = z.object({
  name: z.string().min(1),
  phone: z.string().nullable().optional(),
  trade: z.string().min(1),
  hourlyRate: z.coerce.number().nonnegative(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  biometricId: z.string().nullable().optional(),
});

const include = {
  assignments: {
    where: { endDate: null },
    include: { project: { select: { id: true, name: true } } },
  },
} as const;

// Supervisors see workers currently assigned to their sites; admin sees all.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const where =
      req.user!.role === 'SUPERADMIN'
        ? {}
        : { assignments: { some: { endDate: null, project: projectScope(req.user!) } } };
    res.json(await prisma.worker.findMany({ where, include, orderBy: { name: 'asc' } }));
  }),
);

router.post(
  '/',
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    const worker = await prisma.worker.create({ data: workerSchema.parse(req.body), include });
    audit(req, 'worker.create', 'Worker', worker.id, { name: worker.name });
    res.status(201).json(worker);
  }),
);

router.patch(
  '/:id',
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    const worker = await prisma.worker.update({
      where: { id: req.params.id },
      data: workerSchema.partial().parse(req.body),
      include,
    });
    audit(req, 'worker.update', 'Worker', worker.id);
    res.json(worker);
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
  hourlyRate: z.coerce.number().positive('hourly rate is required and must be greater than 0'),
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

    const results: ImportRowResult[] = [];
    for (const [i, raw] of sheetRows.entries()) {
      const rowNum = i + 2; // header is row 1
      const normalized = normalizeRow(raw);
      const parsed = importRowSchema.safeParse(normalized);
      if (!parsed.success) {
        results.push({
          row: rowNum,
          name: normalized.name,
          status: 'error',
          error: parsed.error.issues.map((iss) => iss.message).join('; '),
        });
        continue;
      }
      const data = parsed.data;
      let biometricId: string | null = data.biometricId?.trim() || null;
      let warning: string | undefined;
      if (biometricId && (existingBiometricIds.has(biometricId) || seenInFile.has(biometricId))) {
        warning = `Biometric ID "${biometricId}" is already in use — worker created without it`;
        biometricId = null;
      }
      if (biometricId) seenInFile.add(biometricId);

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
        results.push({ row: rowNum, name: worker.name, status: 'created', warning });
      } catch {
        results.push({ row: rowNum, name: data.name, status: 'error', error: 'Could not save this row' });
      }
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

router.post(
  '/:id/assign',
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    const { projectId, startDate } = assignSchema.parse(req.body);
    const worker = await prisma.worker.findUnique({ where: { id: req.params.id } });
    if (!worker) throw ApiError.notFound('Worker not found');
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
  requireSuperadmin,
  asyncHandler(async (req, res) => {
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
