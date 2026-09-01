import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import {
  requireFinanceProjectAccess,
  requireFinanceRole,
  requireSuperadmin,
} from '../middleware/rbac';
import {
  projectFinancials,
  companyFinancials,
  getFinanceSettings,
  monthlyTotals,
  toSeries,
} from '../services/finance';
import { leadPipeline } from '../services/pipeline';
import { attentionDigest } from '../services/attention';

const router = Router();
router.use(requireAuth);

/**
 * One project's financial position.
 *
 * Superadmin/Accountant-only despite being project-scoped: it returns
 * contract value, actual spend and estimated profit, which is exactly the
 * data the supervisor shell is built to withhold. `requireFinanceProjectAccess`
 * alone would let an assigned supervisor read their own site's margin
 * straight from the API — the screen never offered it, but the boundary has
 * to hold at the route, not the UI.
 */
router.get(
  '/projects/:projectId',
  requireFinanceRole,
  requireFinanceProjectAccess,
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
//
// The per-site rollup itself is `companyFinancials()` in services/finance.ts
// — extracted there (rather than kept inline here) so the chat assistant's
// `company_financials` lookup can call the exact same arithmetic and can
// never disagree with this page about the company's profit, spend or AR.
router.get(
  '/company',
  requireSuperadmin,
  asyncHandler(async (_req, res) => {
    const settings = await getFinanceSettings();
    const since30d = new Date(Date.now() - 30 * 86400_000);
    const [fin, supervisorsAndDates, overrideAgg, months] = await Promise.all([
      companyFinancials(settings),
      prisma.project.findMany({
        where: { status: { notIn: ['CANCELLED'] } },
        select: {
          id: true,
          clientName: true,
          location: true,
          startDate: true,
          expectedCompletion: true,
          status: true,
          progressPct: true,
          supervisorId: true,
          supervisor: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      // A data-quality signal for this dashboard specifically, not a
      // financial figure — kept out of companyFinancials() so the assistant
      // and every other caller of it aren't carrying a count they never use.
      prisma.attendanceRecord.groupBy({
        by: ['projectId'],
        where: { method: 'MANUAL_OVERRIDE', date: { gte: since30d } },
        _count: true,
      }),
      monthlyTotals(settings.labourCostSource),
    ]);

    // companyFinancials() carries only the figures the arithmetic needs; the
    // fields the dashboard's project table displays alongside them (client,
    // location, dates, supervisor) are joined back in here rather than
    // pushed into the shared function, which every other caller — the chat
    // lookup included — has no use for.
    const byId = new Map(supervisorsAndDates.map((p) => [p.id, p]));
    const overridesByProject = new Map(overrideAgg.map((o) => [o.projectId, o._count]));
    const projects = fin.projects.map((p) => ({
      ...p,
      ...byId.get(p.id),
      manualOverrides30d: overridesByProject.get(p.id) ?? 0,
    }));

    const spendTrend = toSeries(months).map(({ month, total }) => ({ month, total }));
    res.json({ totals: fin.totals, projects, spendTrend });
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
