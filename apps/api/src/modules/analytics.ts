import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { requireProjectAccess, requireSuperadmin } from '../middleware/rbac';
import { projectFinancials, getThresholds, health } from '../services/finance';

const router = Router();
router.use(requireAuth);

/** Monthly expense series (incl. attendance labour cost) for one project. */
async function expenseSeries(projectId: string) {
  const [expenses, attendance] = await Promise.all([
    prisma.expense.findMany({
      where: { projectId },
      select: { amount: true, category: true, expenseDate: true },
    }),
    prisma.attendanceRecord.findMany({
      where: { projectId, labourCost: { not: null } },
      select: { labourCost: true, date: true },
    }),
  ]);
  const byMonth = new Map<string, { month: string; MATERIALS: number; LABOUR: number; TRANSPORT: number; OTHER: number; total: number }>();
  const bucket = (d: Date) => d.toISOString().slice(0, 7);
  const get = (m: string) => {
    if (!byMonth.has(m)) byMonth.set(m, { month: m, MATERIALS: 0, LABOUR: 0, TRANSPORT: 0, OTHER: 0, total: 0 });
    return byMonth.get(m)!;
  };
  for (const e of expenses) {
    const row = get(bucket(e.expenseDate));
    row[e.category] += Number(e.amount);
    row.total += Number(e.amount);
  }
  for (const a of attendance) {
    const row = get(bucket(a.date));
    row.LABOUR += Number(a.labourCost);
    row.total += Number(a.labourCost);
  }
  const series = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
  // Cumulative spend for progress-vs-cost charting.
  let cum = 0;
  return series.map((row) => ({ ...row, cumulative: (cum += row.total) }));
}

router.get(
  '/projects/:projectId',
  requireProjectAccess,
  asyncHandler(async (req, res) => {
    const projectId = req.params.projectId;
    const [project, financials, series] = await Promise.all([
      prisma.project.findUniqueOrThrow({
        where: { id: projectId },
        include: { supervisor: { select: { id: true, name: true } } },
      }),
      projectFinancials(projectId),
      expenseSeries(projectId),
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
      expenseSeries: series,
    });
  }),
);

// Company-wide dashboard — SUPERADMIN only.
router.get(
  '/company',
  requireSuperadmin,
  asyncHandler(async (_req, res) => {
    const projects = await prisma.project.findMany({
      where: { status: { notIn: ['CANCELLED'] } },
      include: { supervisor: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const thresholds = await getThresholds();
    const perProject = await Promise.all(
      projects.map(async (p) => {
        const fin = await projectFinancials(p.id);
        return {
          id: p.id,
          name: p.name,
          status: p.status,
          progressPct: p.progressPct,
          supervisor: p.supervisor,
          contractValue: fin.contractValue,
          totalBudget: fin.totalBudget,
          totalActual: fin.totalActual,
          estimatedProfit: fin.estimatedProfit,
          consumedPct: fin.overallConsumedPct,
          health: fin.overallHealth,
        };
      }),
    );
    const totals = perProject.reduce(
      (acc, p) => ({
        contractValue: acc.contractValue + p.contractValue,
        totalActual: acc.totalActual + p.totalActual,
        estimatedProfit: acc.estimatedProfit + p.estimatedProfit,
        totalBudget: acc.totalBudget + p.totalBudget,
      }),
      { contractValue: 0, totalActual: 0, estimatedProfit: 0, totalBudget: 0 },
    );
    const overallPct =
      totals.totalBudget > 0 ? Math.round((totals.totalActual / totals.totalBudget) * 100) : null;

    // Combined monthly spend across all projects.
    const seriesPerProject = await Promise.all(projects.map((p) => expenseSeries(p.id)));
    const combined = new Map<string, { month: string; total: number }>();
    for (const series of seriesPerProject) {
      for (const row of series) {
        const agg = combined.get(row.month) ?? { month: row.month, total: 0 };
        agg.total += row.total;
        combined.set(row.month, agg);
      }
    }
    res.json({
      totals: { ...totals, overallHealth: health(overallPct, thresholds) },
      projects: perProject,
      spendTrend: [...combined.values()].sort((a, b) => a.month.localeCompare(b.month)),
    });
  }),
);

export default router;
