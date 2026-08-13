import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { requireProjectAccess, requireSuperadmin } from '../middleware/rbac';
import {
  projectFinancials,
  getFinanceSettings,
  health,
  buildCategories,
  monthlyTotals,
  toSeries,
} from '../services/finance';
import { companyReceivables } from '../services/invoicing';
import { leadPipeline } from '../services/pipeline';
import { attentionDigest } from '../services/attention';

const router = Router();
router.use(requireAuth);

/**
 * One project's financial position.
 *
 * Superadmin-only despite being project-scoped: it returns contract value,
 * actual spend and estimated profit, which is exactly the data the supervisor
 * shell is built to withhold. `requireProjectAccess` alone let an assigned
 * supervisor read their own site's margin straight from the API — the screen
 * never offered it, but the boundary has to hold at the route, not the UI.
 */
router.get(
  '/projects/:projectId',
  requireSuperadmin,
  requireProjectAccess,
  asyncHandler(async (req, res) => {
    const projectId = req.params.projectId;
    const settings = await getFinanceSettings();
    const [project, financials, months] = await Promise.all([
      prisma.project.findUniqueOrThrow({
        where: { id: projectId },
        include: { supervisor: { select: { id: true, name: true } } },
      }),
      projectFinancials(projectId, settings),
      monthlyTotals(settings.labourCostSource, [projectId]),
    ]);
    res.json({
      project: {
        id: project.id,
        name: project.name,
        status: project.status,
        progressPct: project.progressPct,
        supervisor: project.supervisor,
      },
      financials,
      expenseSeries: toSeries(months),
    });
  }),
);

// Company-wide dashboard — SUPERADMIN only. Fixed number of grouped queries
// regardless of how many projects or rows exist.
router.get(
  '/company',
  requireSuperadmin,
  asyncHandler(async (_req, res) => {
    const settings = await getFinanceSettings();
    const since30d = new Date(Date.now() - 30 * 86400_000);
    const [projects, budgetLines, expenseAgg, labourAgg, overrideAgg, paymentAgg, months] =
      await Promise.all([
        prisma.project.findMany({
          where: { status: { notIn: ['CANCELLED'] } },
          include: { supervisor: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'asc' },
        }),
        prisma.budgetLine.findMany(),
        prisma.expense.groupBy({
          by: ['projectId', 'category'],
          where: { status: 'APPROVED' },
          _sum: { amount: true },
        }),
        prisma.attendanceRecord.groupBy({
          by: ['projectId'],
          where: { labourCost: { not: null } },
          _sum: { labourCost: true },
        }),
        prisma.attendanceRecord.groupBy({
          by: ['projectId'],
          where: { method: 'MANUAL_OVERRIDE', date: { gte: since30d } },
          _count: true,
        }),
        // voidedAt: null — a voided receipt is not money received. Omitting
        // this filter silently overstates collections across the dashboard.
        prisma.payment.groupBy({
          by: ['projectId'],
          where: { voidedAt: null },
          _sum: { amount: true },
        }),
        monthlyTotals(settings.labourCostSource),
      ]);

    // Index each aggregate array once so the per-project loop below is O(P), not O(P x Q).
    const expenseByProject = new Map<string, Record<string, number>>();
    for (const row of expenseAgg) {
      const bucket = expenseByProject.get(row.projectId) ?? {};
      bucket[row.category] = Number(row._sum.amount ?? 0);
      expenseByProject.set(row.projectId, bucket);
    }
    const labourByProject = new Map(labourAgg.map((a) => [a.projectId, Number(a._sum.labourCost ?? 0)]));
    const overridesByProject = new Map(overrideAgg.map((o) => [o.projectId, o._count]));
    const collectedByProject = new Map(paymentAgg.map((a) => [a.projectId, Number(a._sum.amount ?? 0)]));
    const budgetLinesByProject = new Map<string, typeof budgetLines>();
    for (const line of budgetLines) {
      const bucket = budgetLinesByProject.get(line.projectId) ?? [];
      bucket.push(line);
      budgetLinesByProject.set(line.projectId, bucket);
    }

    const perProject = projects.map((p) => {
      const expenseByCategory = expenseByProject.get(p.id) ?? {};
      const attendanceLabour = labourByProject.get(p.id) ?? 0;
      const categories = buildCategories(
        budgetLinesByProject.get(p.id) ?? [],
        { expenseByCategory, attendanceLabour },
        settings,
      );
      const totalBudget = categories.reduce((s, c) => s + c.allocated, 0);
      const totalActual = categories.reduce((s, c) => s + c.actual, 0);
      const contractValue = Number(p.contractValue);
      const consumedPct = totalBudget > 0 ? Math.round((totalActual / totalBudget) * 100) : null;
      const totalCollected = collectedByProject.get(p.id) ?? 0;
      return {
        id: p.id,
        name: p.name,
        clientName: p.clientName,
        location: p.location,
        startDate: p.startDate,
        expectedCompletion: p.expectedCompletion,
        status: p.status,
        progressPct: p.progressPct,
        supervisorId: p.supervisorId,
        supervisor: p.supervisor,
        contractValue,
        totalBudget,
        totalActual,
        estimatedProfit: contractValue - totalActual,
        consumedPct,
        health: health(consumedPct, settings.thresholds),
        manualOverrides30d: overridesByProject.get(p.id) ?? 0,
        totalCollected,
        pendingBalance: contractValue - totalCollected,
      };
    });

    const totals = perProject.reduce(
      (acc, p) => ({
        contractValue: acc.contractValue + p.contractValue,
        totalActual: acc.totalActual + p.totalActual,
        estimatedProfit: acc.estimatedProfit + p.estimatedProfit,
        totalBudget: acc.totalBudget + p.totalBudget,
        totalCollected: acc.totalCollected + p.totalCollected,
      }),
      { contractValue: 0, totalActual: 0, estimatedProfit: 0, totalBudget: 0, totalCollected: 0 },
    );
    const overallPct =
      totals.totalBudget > 0 ? Math.round((totals.totalActual / totals.totalBudget) * 100) : null;

    const spendTrend = toSeries(months).map(({ month, total }) => ({ month, total }));
    // Receivables answer a different question from pendingBalance: this is what
    // has been *billed* and not yet paid, whereas pendingBalance is everything
    // still owed on the contract including work not yet invoiced.
    const receivables = await companyReceivables(perProject.map((p) => p.id));
    res.json({
      totals: {
        ...totals,
        totalPendingBalance: totals.contractValue - totals.totalCollected,
        arOutstanding: receivables.totalAr,
        arOverdue: receivables.totalOverdue,
        retentionHeld: receivables.retentionHeld,
        overallHealth: health(overallPct, settings.thresholds),
      },
      projects: perProject,
      spendTrend,
    });
  }),
);

// The Overview digest: only the projects that need the owner's attention,
// grouped by reason. Never a wall of metrics — just "what needs a decision".
// The assistant's `company_operations` lookup asks this exact question too
// (services/chatRetrieval.ts), via the same attentionDigest() call, so the
// two can never disagree.
router.get(
  '/attention',
  requireSuperadmin,
  asyncHandler(async (_req, res) => {
    res.json(await attentionDigest());
  }),
);

/**
 * The pre-project pipeline in one call — what is being chased, what is sitting
 * with a client, and what has been agreed but not yet started.
 *
 * One endpoint rather than the dashboard making four list requests and counting
 * them in the browser: these are aggregates, and aggregating them is the
 * database's job.
 */
router.get(
  '/pipeline',
  requireSuperadmin,
  asyncHandler(async (_req, res) => {
    const [leads, awaitingDecision, awaitingSignature, unstarted] = await Promise.all([
      leadPipeline(),
      prisma.quotation.aggregate({
        where: { status: 'SENT' },
        _count: true,
        _sum: { total: true },
      }),
      prisma.contract.aggregate({
        where: { status: 'ISSUED' },
        _count: true,
        _sum: { originalValue: true },
      }),
      // Agreed but with no site opened against it yet — the gap where a job can
      // sit forgotten between the office and the field.
      prisma.contract.aggregate({
        where: { projectId: null, status: { in: ['SIGNED', 'ACTIVE'] } },
        _count: true,
        _sum: { originalValue: true },
      }),
    ]);

    res.json({
      openLeads: { count: leads.open, value: leads.openValue },
      leadsByStage: leads.byStage,
      quotationsAwaitingDecision: {
        count: awaitingDecision._count,
        value: Number(awaitingDecision._sum.total ?? 0),
      },
      contractsAwaitingSignature: {
        count: awaitingSignature._count,
        value: Number(awaitingSignature._sum.originalValue ?? 0),
      },
      contractsWithoutSite: {
        count: unstarted._count,
        value: Number(unstarted._sum.originalValue ?? 0),
      },
    });
  }),
);

export default router;
