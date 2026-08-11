import { Router } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { asyncHandler, ApiError } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { projectScope, requireSuperadmin } from '../middleware/rbac';
import { visibleWorker, visibleWorkers } from '../services/payVisibility';
import { audit } from '../middleware/audit';
import { fileUrl, removeUploadedFile, signFileUrl, upload, verifyUpload } from '../middleware/upload';
import {
  accruedByWorker,
  assertWorkerPaymentAllowed,
  getStaffTaxConfig,
  withholdingOn,
  WorkerPayError,
  workerPayablesSummary,
  workerPosition,
  type WorkerPaymentRecord,
} from '../services/workerPay';

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
  .max(MAX_HOURLY_RATE, `Hourly rate looks too high (over KES ${MAX_HOURLY_RATE.toLocaleString()}/hr) — check for an extra digit`);

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
//
// The pay rate is not here. It is the office's decision, it feeds labour cost
// and budget health directly, and a rate set from a site screen would reach
// those numbers without anyone in the office having agreed it. A fundi a
// supervisor adds starts at zero and the Workers screen flags them until the
// office sets it — see services/payVisibility.ts.
const supervisorWorkerSchema = z.object({
  name: z.string().min(1),
  phone: z.string().nullable().optional(),
  trade: z.string().min(1),
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
    const workers = await prisma.worker.findMany({ where, include, orderBy: { name: 'asc' } });
    res.json(visibleWorkers(workers, req.user!.role));
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
    // A supervisor sets no rate, so the fundi starts at zero and the office
    // is prompted to set it. Both branches carry the field, so what reaches
    // the database is one shape.
    const data = isAdmin
      ? workerSchema.parse(body)
      : { ...supervisorWorkerSchema.parse(body), hourlyRate: 0 };

    if (!isAdmin) {
      if (typeof projectId !== 'string' || !projectId) {
        throw ApiError.badRequest('projectId is required');
      }
      await assertOwnProject(req.user!.id, req.user!.role, projectId);
    }

    const worker = await prisma.$transaction(async (tx) => {
      const created = await tx.worker.create({
        data,
      });
      if (projectId) {
        await tx.workerAssignment.create({ data: { workerId: created.id, projectId } });
      }
      return tx.worker.findUniqueOrThrow({ where: { id: created.id }, include });
    });
    audit(req, 'worker.create', 'Worker', worker.id, { name: worker.name, projectId });
    res.status(201).json(visibleWorker(worker, req.user!.role));
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
    res.json(visibleWorker(worker, req.user!.role));
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
    .max(MAX_HOURLY_RATE, `hourly rate over KES ${MAX_HOURLY_RATE.toLocaleString()}/hr — check for an extra digit`),
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

// ---- Paying casual/contracted staff, and what is withheld from them ------
//
// Superadmin-only throughout, matching suppliers.ts and payments.ts: what a
// worker is owed and what tax was withheld is company financial data a site
// supervisor must never see.

/** An untouched form field arrives as "", which is absent, not a value. */
const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalText = z.preprocess(blank, z.string().trim().optional());
const formBool = z.preprocess(
  (v) => (typeof v === 'string' ? ['true', 'on', '1', 'yes'].includes(v.toLowerCase()) : v),
  z.boolean(),
);

const workerPaymentSchema = z.object({
  amount: z.coerce.number().nonnegative('A payment cannot be negative'),
  method: z.enum(['CASH', 'BANK_TRANSFER', 'MPESA', 'CHEQUE', 'OTHER']),
  paymentDate: z.coerce.date(),
  referenceNo: optionalText,
  notes: optionalText,
  // Tax deducted from this payment and owed to KRA rather than the worker.
  whtAmount: z.preprocess(blank, z.coerce.number().nonnegative().optional()),
  whtCertNo: optionalText,
  // Only set when the record genuinely calls for more than is outstanding.
  allowOverpayment: z.preprocess((v) => blank(v) ?? false, formBool),
});

type WorkerPaymentRow = {
  amount: unknown;
  whtAmount: unknown;
  proofUrl?: string | null;
  [k: string]: unknown;
};

const serializeWorkerPayment = (p: WorkerPaymentRow) => ({
  ...p,
  amount: Number(p.amount),
  whtAmount: Number(p.whtAmount),
  proofUrl: signFileUrl(p.proofUrl ?? null),
});

/**
 * The company-wide position: what every worker is owed, cash paid, tax
 * withheld. Registered before /:id so "payables" is never read as a worker id.
 */
router.get(
  '/payables',
  requireSuperadmin,
  asyncHandler(async (_req, res) => {
    const workers = await prisma.worker.findMany({
      select: { id: true, name: true, trade: true },
    });
    const [accrued, payments] = await Promise.all([
      accruedByWorker(),
      prisma.workerPayment.findMany({ select: { workerId: true, amount: true, whtAmount: true } }),
    ]);
    const paymentsByWorker = new Map<string, WorkerPaymentRecord[]>();
    for (const p of payments) {
      const list = paymentsByWorker.get(p.workerId) ?? [];
      list.push({ amount: Number(p.amount), whtAmount: Number(p.whtAmount) });
      paymentsByWorker.set(p.workerId, list);
    }

    const positions = workers.map((w) => ({
      worker: w,
      ...workerPosition(accrued.get(w.id) ?? 0, paymentsByWorker.get(w.id) ?? []),
    }));
    // Most owed first: that is the one that matters if cash is short this week.
    positions.sort((a, b) => b.outstanding - a.outstanding);

    res.json({
      summary: workerPayablesSummary(positions),
      workers: positions,
    });
  }),
);

router.get(
  '/:id/payment-suggestion',
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    const worker = await prisma.worker.findUnique({ where: { id: req.params.id } });
    if (!worker) throw ApiError.notFound('Worker not found');

    const [accrued, payments, tax] = await Promise.all([
      accruedByWorker([worker.id]),
      prisma.workerPayment.findMany({
        where: { workerId: worker.id },
        orderBy: { paymentDate: 'desc' },
        include: { paidBy: { select: { id: true, name: true } } },
      }),
      getStaffTaxConfig(),
    ]);
    const paymentRecords: WorkerPaymentRecord[] = payments.map((p) => ({
      amount: Number(p.amount),
      whtAmount: Number(p.whtAmount),
    }));
    const position = workerPosition(accrued.get(worker.id) ?? 0, paymentRecords);
    const suggestedWht = tax.withholdingAgent
      ? withholdingOn(position.outstanding, tax.defaultWhtRatePct)
      : 0;

    res.json({
      position,
      tax,
      suggested: {
        whtAmount: suggestedWht,
        amount: Math.max(0, Math.round((position.outstanding - suggestedWht) * 100) / 100),
      },
      payments: payments.map(serializeWorkerPayment),
    });
  }),
);

router.post(
  '/:id/payments',
  requireSuperadmin,
  upload.single('proof'),
  asyncHandler(async (req, res) => {
    const data = workerPaymentSchema.parse(req.body);
    await verifyUpload(req.file);

    const worker = await prisma.worker.findUnique({ where: { id: req.params.id } });
    if (!worker) throw ApiError.notFound('Worker not found');

    const [accrued, existing] = await Promise.all([
      accruedByWorker([worker.id]),
      prisma.workerPayment.findMany({
        where: { workerId: worker.id },
        select: { amount: true, whtAmount: true },
      }),
    ]);
    const payment: WorkerPaymentRecord = { amount: data.amount, whtAmount: data.whtAmount ?? 0 };
    try {
      assertWorkerPaymentAllowed(
        accrued.get(worker.id) ?? 0,
        existing.map((p) => ({ amount: Number(p.amount), whtAmount: Number(p.whtAmount) })),
        payment,
        { allowOverpayment: data.allowOverpayment },
      );
    } catch (e) {
      if (e instanceof WorkerPayError) throw ApiError.badRequest(e.message);
      throw e;
    }

    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.workerPayment.create({
        data: {
          workerId: worker.id,
          amount: data.amount,
          method: data.method,
          paymentDate: data.paymentDate,
          referenceNo: data.referenceNo,
          notes: data.notes,
          whtAmount: payment.whtAmount,
          whtCertNo: data.whtCertNo,
          proofUrl: req.file ? fileUrl(req.file.filename) : undefined,
          paidById: req.user!.id,
        },
        include: { paidBy: { select: { id: true, name: true } } },
      });
      await tx.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'workerPayment.create',
          entity: 'WorkerPayment',
          entityId: row.id,
          meta: { workerId: worker.id, amount: data.amount, whtAmount: payment.whtAmount },
          ip: req.ip,
        },
      });
      return row;
    });

    res.status(201).json(serializeWorkerPayment(created));
  }),
);

router.delete(
  '/:id/payments/:paymentId',
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    const payment = await prisma.workerPayment.findUnique({ where: { id: req.params.paymentId } });
    if (!payment || payment.workerId !== req.params.id) throw ApiError.notFound();
    // Withheld tax already remitted to KRA cannot be unwound by deleting the
    // row it was recorded on — the money is gone and the certificate issued.
    if (payment.whtRemittedAt) {
      throw ApiError.conflict(
        'The tax withheld on this payment has already been remitted to KRA. Record a correcting entry instead of deleting it.',
      );
    }
    await prisma.workerPayment.delete({ where: { id: payment.id } });
    removeUploadedFile(payment.proofUrl);
    audit(req, 'workerPayment.delete', 'WorkerPayment', payment.id, {
      workerId: payment.workerId,
      amount: Number(payment.amount),
    });
    res.json({ ok: true });
  }),
);

export default router;
