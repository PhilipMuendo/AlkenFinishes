import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ApiError, asyncHandler } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { requireSuperadmin } from '../middleware/rbac';
import { audit } from '../middleware/audit';
import {
  computePayslip,
  getPayrollConfig,
  payrollTotals,
  type Payslip,
  type PayrollConfig,
} from '../services/payroll';

/**
 * Payroll.
 *
 * Superadmin-only: what everybody earns, and what is withheld from them, is
 * the most sensitive data in the system.
 *
 * Gross is built from attendance already recorded — hours at the worker's rate
 * — so nothing is retyped from the fingerprint reader. A run is a DRAFT until
 * it is finalised, and finalising is what makes its figures permanent.
 */
const router = Router();
router.use(requireAuth, requireSuperadmin);

const serializeLine = (l: {
  hoursWorked: Prisma.Decimal;
  gross: Prisma.Decimal;
  nssf: Prisma.Decimal;
  paye: Prisma.Decimal;
  shif: Prisma.Decimal;
  housingLevy: Prisma.Decimal;
  totalDeductions: Prisma.Decimal;
  netPay: Prisma.Decimal;
  employerNssf: Prisma.Decimal;
  employerHousingLevy: Prisma.Decimal;
  [k: string]: unknown;
}) => ({
  ...l,
  hoursWorked: Number(l.hoursWorked),
  gross: Number(l.gross),
  nssf: Number(l.nssf),
  paye: Number(l.paye),
  shif: Number(l.shif),
  housingLevy: Number(l.housingLevy),
  totalDeductions: Number(l.totalDeductions),
  netPay: Number(l.netPay),
  employerNssf: Number(l.employerNssf),
  employerHousingLevy: Number(l.employerHousingLevy),
});

/** Totals are always derived from the stored lines, never stored themselves. */
const asPayslip = (l: ReturnType<typeof serializeLine>): Payslip => ({
  gross: l.gross,
  nssf: l.nssf,
  taxablePay: l.gross - l.nssf,
  payeBeforeRelief: 0,
  personalRelief: 0,
  paye: l.paye,
  shif: l.shif,
  housingLevy: l.housingLevy,
  totalDeductions: l.totalDeductions,
  netPay: l.netPay,
  employerNssf: l.employerNssf,
  employerHousingLevy: l.employerHousingLevy,
  employerCost: l.gross + l.employerNssf + l.employerHousingLevy,
});

/**
 * Wages earned per worker in a period, from attendance.
 *
 * Only records with a labour cost count: an open shift with no check-out has
 * no hours yet, and guessing at one would pay somebody for time they may not
 * have worked.
 */
async function grossByWorker(from: Date, to: Date, projectId?: string) {
  const rows = await prisma.attendanceRecord.groupBy({
    by: ['workerId'],
    where: {
      date: { gte: from, lte: to },
      labourCost: { not: null },
      ...(projectId ? { projectId } : {}),
    },
    _sum: { labourCost: true, hoursWorked: true },
  });
  return rows;
}

const periodSchema = z.object({
  periodFrom: z.coerce.date(),
  periodTo: z.coerce.date(),
  projectId: z.string().optional(),
});

/**
 * What a run would look like, without writing anything.
 *
 * The office needs to see who is in it and what it costs before committing —
 * a payroll run creates a legal record of what was withheld from somebody.
 */
router.post(
  '/preview',
  asyncHandler(async (req, res) => {
    const { periodFrom, periodTo, projectId } = periodSchema.parse(req.body);
    if (periodFrom > periodTo) throw ApiError.badRequest('The period ends before it starts');

    const config = await getPayrollConfig();
    const [totals, workers] = await Promise.all([
      grossByWorker(periodFrom, periodTo, projectId),
      prisma.worker.findMany({ select: { id: true, name: true, trade: true, hourlyRate: true } }),
    ]);
    const byId = new Map(workers.map((w) => [w.id, w]));

    const lines = totals.map((t) => {
      const worker = byId.get(t.workerId);
      const slip = computePayslip({ gross: Number(t._sum.labourCost ?? 0) }, config);
      return {
        workerId: t.workerId,
        workerName: worker?.name ?? 'Unknown worker',
        trade: worker?.trade ?? '',
        hoursWorked: Number(t._sum.hoursWorked ?? 0),
        // Hours on site but no rate set, so this run would pay them nothing.
        // A supervisor can add a fundi but not price them, so the gap is
        // ordinary and has to be visible before the run is finalised — this
        // is somebody's wages, not a rounding difference.
        rateMissing: Number(worker?.hourlyRate ?? 0) === 0,
        ...slip,
      };
    });
    lines.sort((a, b) => b.gross - a.gross);

    res.json({ config, lines, totals: payrollTotals(lines) });
  }),
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const runs = await prisma.payrollRun.findMany({
      include: {
        project: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        lines: true,
      },
      orderBy: [{ periodFrom: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });
    res.json(
      runs.map((r) => {
        const lines = r.lines.map(serializeLine);
        return {
          ...r,
          lines: undefined,
          workerCount: lines.length,
          totals: payrollTotals(lines.map(asPayslip)),
        };
      }),
    );
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { periodFrom, periodTo, projectId, notes } = periodSchema
      .extend({ notes: z.string().trim().optional() })
      .parse(req.body);
    if (periodFrom > periodTo) throw ApiError.badRequest('The period ends before it starts');

    const config = await getPayrollConfig();
    const [totals, workers] = await Promise.all([
      grossByWorker(periodFrom, periodTo, projectId),
      prisma.worker.findMany({ select: { id: true, name: true, trade: true } }),
    ]);
    if (totals.length === 0) {
      throw ApiError.badRequest(
        'No completed attendance in that period, so there is nothing to pay. Check the dates, and that shifts have been closed.',
      );
    }
    const byId = new Map(workers.map((w) => [w.id, w]));

    const run = await prisma.$transaction(async (tx) => {
      const created = await tx.payrollRun.create({
        data: {
          projectId,
          periodFrom,
          periodTo,
          notes,
          // Verbatim, so reopening this run in December still shows the rates
          // that were in force when it was made.
          configSnapshot: config as unknown as Prisma.InputJsonValue,
          createdById: req.user!.id,
          lines: {
            create: totals.map((t) => {
              const worker = byId.get(t.workerId);
              const slip = computePayslip({ gross: Number(t._sum.labourCost ?? 0) }, config);
              return {
                workerId: t.workerId,
                workerName: worker?.name ?? 'Unknown worker',
                trade: worker?.trade ?? '',
                hoursWorked: Number(t._sum.hoursWorked ?? 0),
                gross: slip.gross,
                nssf: slip.nssf,
                paye: slip.paye,
                shif: slip.shif,
                housingLevy: slip.housingLevy,
                totalDeductions: slip.totalDeductions,
                netPay: slip.netPay,
                employerNssf: slip.employerNssf,
                employerHousingLevy: slip.employerHousingLevy,
              };
            }),
          },
        },
        include: { lines: true, project: { select: { id: true, name: true } } },
      });
      await tx.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'payroll.create',
          entity: 'PayrollRun',
          entityId: created.id,
          meta: { workers: created.lines.length, periodFrom, periodTo },
          ip: req.ip,
        },
      });
      return created;
    });

    const lines = run.lines.map(serializeLine);
    res.status(201).json({ ...run, lines, totals: payrollTotals(lines.map(asPayslip)) });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const run = await prisma.payrollRun.findUnique({
      where: { id: req.params.id },
      include: {
        lines: { orderBy: { gross: 'desc' } },
        project: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });
    if (!run) throw ApiError.notFound('Payroll run not found');

    const lines = run.lines.map(serializeLine);
    res.json({
      ...run,
      lines,
      totals: payrollTotals(lines.map(asPayslip)),
      // The rates this run was computed with, not today's.
      config: run.configSnapshot as unknown as PayrollConfig,
    });
  }),
);

/**
 * Finalise: the figures become permanent.
 *
 * After this the run is a record of what was withheld from real people, so it
 * can no longer be deleted or rebuilt from attendance that may since have been
 * edited.
 */
router.post(
  '/:id/finalise',
  asyncHandler(async (req, res) => {
    const run = await prisma.payrollRun.findUnique({ where: { id: req.params.id } });
    if (!run) throw ApiError.notFound('Payroll run not found');
    if (run.status === 'FINALISED') throw ApiError.conflict('This run is already finalised');

    const updated = await prisma.payrollRun.update({
      where: { id: run.id },
      data: { status: 'FINALISED', finalisedAt: new Date() },
    });
    audit(req, 'payroll.finalise', 'PayrollRun', run.id, {});
    res.json(updated);
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const run = await prisma.payrollRun.findUnique({ where: { id: req.params.id } });
    if (!run) throw ApiError.notFound('Payroll run not found');
    if (run.status === 'FINALISED') {
      throw ApiError.conflict(
        'A finalised run is the record of what was withheld from your workers. It cannot be deleted.',
      );
    }
    await prisma.payrollRun.delete({ where: { id: run.id } });
    audit(req, 'payroll.delete', 'PayrollRun', run.id, {});
    res.json({ ok: true });
  }),
);

export default router;
