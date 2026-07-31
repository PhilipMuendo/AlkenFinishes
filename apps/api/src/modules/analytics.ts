import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { asyncHandler } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { requireProjectAccess, requireSuperadmin } from '../middleware/rbac';
import { projectFinancials, getFinanceSettings, buildCategories, health } from '../services/finance';
import {
  companyReceivables,
  daysOverdue,
  invoiceBalanceCents,
  LIVE_INVOICE_STATUSES,
} from '../services/invoicing';
import { toCents } from '../services/money';

const router = Router();
router.use(requireAuth);

interface MonthRow {
  month: string;
  category: string;
  total: number;
}

/**
 * Monthly totals aggregated in SQL (timezone-aware), never by loading rows
 * into the app. Cost is O(distinct months × categories) regardless of volume.
 */
async function monthlyTotals(
  labourCostSource: 'ATTENDANCE' | 'EXPENSES' | 'BOTH',
  projectIds?: string[],
): Promise<MonthRow[]> {
  if (projectIds && projectIds.length === 0) return [];
  // The trend must use the same labour definition as the actuals.
  const expenseCat =
    labourCostSource === 'ATTENDANCE' ? Prisma.sql`AND e.category != 'LABOUR'` : Prisma.empty;
  const scopeExpense = projectIds
    ? Prisma.sql`WHERE e."projectId" IN (${Prisma.join(projectIds)}) ${expenseCat}`
    : Prisma.sql`WHERE true ${expenseCat}`;
  const scopeAtt = projectIds
    ? Prisma.sql`WHERE a."labourCost" IS NOT NULL AND a."projectId" IN (${Prisma.join(projectIds)})`
    : Prisma.sql`WHERE a."labourCost" IS NOT NULL`;
  const attendanceArm =
    labourCostSource === 'EXPENSES'
      ? Prisma.empty
      : Prisma.sql`
      UNION ALL
      SELECT to_char(a.date, 'YYYY-MM') AS month, 'LABOUR' AS category, SUM(a."labourCost") AS total
      FROM "AttendanceRecord" a ${scopeAtt}
      GROUP BY 1, 2`;
  const rows = await prisma.$queryRaw<{ month: string; category: string; total: number }[]>`
    SELECT month, category, SUM(total)::float8 AS total FROM (
      SELECT to_char((e."expenseDate" AT TIME ZONE 'UTC') AT TIME ZONE ${env.APP_TIMEZONE}, 'YYYY-MM') AS month,
             e.category::text AS category, SUM(e.amount) AS total
      FROM "Expense" e ${scopeExpense}
      GROUP BY 1, 2
      ${attendanceArm}
    ) t GROUP BY month, category ORDER BY month`;
  return rows;
}

function toSeries(rows: MonthRow[]) {
  const byMonth = new Map<
    string,
    { month: string; MATERIALS: number; LABOUR: number; TRANSPORT: number; OTHER: number; total: number }
  >();
  for (const r of rows) {
    if (!byMonth.has(r.month)) {
      byMonth.set(r.month, { month: r.month, MATERIALS: 0, LABOUR: 0, TRANSPORT: 0, OTHER: 0, total: 0 });
    }
    const row = byMonth.get(r.month)!;
    const cat = r.category as 'MATERIALS' | 'LABOUR' | 'TRANSPORT' | 'OTHER';
    row[cat] += r.total;
    row.total += r.total;
  }
  let cum = 0;
  return [...byMonth.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((row) => ({ ...row, cumulative: (cum += row.total) }));
}

router.get(
  '/projects/:projectId',
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
        prisma.expense.groupBy({ by: ['projectId', 'category'], _sum: { amount: true } }),
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

const DAY = 86_400_000;
const QUIET_AFTER_DAYS = 4; // an active site with no report in this long has "gone quiet"
const FINISHING_SOON_DAYS = 14;

// The Overview digest: only the projects that need the owner's attention,
// grouped by reason. Never a wall of metrics — just "what needs a decision".
router.get(
  '/attention',
  requireSuperadmin,
  asyncHandler(async (_req, res) => {
    const settings = await getFinanceSettings();
    const now = Date.now();
    const [projects, budgetLines, expenseAgg, labourAgg, paymentAgg, dailyMax, weeklyMax] =
      await Promise.all([
        prisma.project.findMany({
          where: { status: { notIn: ['CANCELLED'] } },
          include: { supervisor: { select: { id: true, name: true } } },
        }),
        prisma.budgetLine.findMany(),
        prisma.expense.groupBy({ by: ['projectId', 'category'], _sum: { amount: true } }),
        prisma.attendanceRecord.groupBy({
          by: ['projectId'],
          where: { labourCost: { not: null } },
          _sum: { labourCost: true },
        }),
        // voidedAt: null — a voided receipt is not money received. Omitting
        // this filter silently overstates collections across the dashboard.
        prisma.payment.groupBy({
          by: ['projectId'],
          where: { voidedAt: null },
          _sum: { amount: true },
        }),
        prisma.dailyReport.groupBy({ by: ['projectId'], _max: { date: true } }),
        prisma.weeklyReport.groupBy({ by: ['projectId'], _max: { weekEnding: true } }),
      ]);

    const budgetByProject = new Map<string, typeof budgetLines>();
    for (const b of budgetLines) {
      const list = budgetByProject.get(b.projectId) ?? [];
      list.push(b);
      budgetByProject.set(b.projectId, list);
    }
    const expenseByProject = new Map<string, Record<string, number>>();
    for (const row of expenseAgg) {
      const bucket = expenseByProject.get(row.projectId) ?? {};
      bucket[row.category] = Number(row._sum.amount ?? 0);
      expenseByProject.set(row.projectId, bucket);
    }
    const labourByProject = new Map(labourAgg.map((a) => [a.projectId, Number(a._sum.labourCost ?? 0)]));
    const collectedByProject = new Map(paymentAgg.map((a) => [a.projectId, Number(a._sum.amount ?? 0)]));
    const lastReportByProject = new Map<string, number>();
    for (const d of dailyMax) if (d._max.date) lastReportByProject.set(d.projectId, d._max.date.getTime());
    for (const w of weeklyMax) {
      if (!w._max.weekEnding) continue;
      const t = w._max.weekEnding.getTime();
      lastReportByProject.set(w.projectId, Math.max(lastReportByProject.get(w.projectId) ?? 0, t));
    }

    const paymentOverdue: unknown[] = [];
    const overBudget: unknown[] = [];
    const unassigned: unknown[] = [];
    const wentQuiet: unknown[] = [];
    const finishingSoon: unknown[] = [];
    let activeCount = 0;

    for (const p of projects) {
      const isActive = p.status === 'ACTIVE';
      const isSpending = p.status === 'ACTIVE' || p.status === 'ON_HOLD';
      if (isActive) activeCount++;

      const categories = buildCategories(
        budgetByProject.get(p.id) ?? [],
        {
          expenseByCategory: expenseByProject.get(p.id) ?? {},
          attendanceLabour: labourByProject.get(p.id) ?? 0,
        },
        settings,
      );
      const totalBudget = categories.reduce((s, c) => s + c.allocated, 0);
      const totalActual = categories.reduce((s, c) => s + c.actual, 0);
      const consumedPct = totalBudget > 0 ? Math.round((totalActual / totalBudget) * 100) : null;
      const pendingBalance = Number(p.contractValue) - (collectedByProject.get(p.id) ?? 0);

      // Money owed, past the agreed date.
      if (p.balanceDueDate && p.balanceDueDate.getTime() < now && pendingBalance > 0) {
        paymentOverdue.push({
          id: p.id,
          name: p.name,
          pendingBalance,
          balanceDueDate: p.balanceDueDate,
          daysOverdue: Math.floor((now - p.balanceDueDate.getTime()) / DAY),
        });
      }
      // Spending sites over the risk threshold.
      if (isSpending && health(consumedPct, settings.thresholds) === 'RED') {
        overBudget.push({ id: p.id, name: p.name, consumedPct });
      }
      if (isActive && !p.supervisorId) {
        unassigned.push({ id: p.id, name: p.name });
      }
      if (isActive) {
        const last = lastReportByProject.get(p.id) ?? null;
        const daysSince = last == null ? null : Math.floor((now - last) / DAY);
        if (daysSince == null || daysSince > QUIET_AFTER_DAYS) {
          wentQuiet.push({ id: p.id, name: p.name, lastReportAt: last ? new Date(last) : null, daysSince });
        }
        const daysLeft = Math.ceil((p.expectedCompletion.getTime() - now) / DAY);
        if (daysLeft >= 0 && daysLeft <= FINISHING_SOON_DAYS) {
          finishingSoon.push({ id: p.id, name: p.name, expectedCompletion: p.expectedCompletion, daysLeft });
        }
      }
    }

    // Overdue *invoices*, a different question from paymentOverdue above:
    // that flags a whole site past its contractual balance date, this flags an
    // individual issued invoice past its own due date. Both matter.
    const projectNames = new Map(projects.map((p) => [p.id, p.name]));
    const liveInvoices = await prisma.invoice.findMany({
      where: {
        status: { in: LIVE_INVOICE_STATUSES },
        dueDate: { lt: new Date(now) },
        projectId: { in: projects.map((p) => p.id) },
      },
      include: { payments: { where: { voidedAt: null }, select: { amount: true } } },
      orderBy: { dueDate: 'asc' },
    });
    const invoiceOverdue = liveInvoices
      .map((inv) => {
        const paid = inv.payments.reduce((s, pm) => s + toCents(pm.amount), 0);
        const balanceCents = invoiceBalanceCents(toCents(inv.netPayable), paid);
        return {
          id: inv.id,
          projectId: inv.projectId,
          name: projectNames.get(inv.projectId) ?? '',
          invoiceNo: inv.invoiceNo,
          clientName: inv.clientName,
          balance: balanceCents / 100,
          dueDate: inv.dueDate,
          daysOverdue: daysOverdue(inv.dueDate, balanceCents, new Date(now)),
        };
      })
      .filter((r) => r.balance > 0)
      .sort((a, b) => b.daysOverdue - a.daysOverdue);

    paymentOverdue.sort((a: any, b: any) => b.daysOverdue - a.daysOverdue);
    finishingSoon.sort((a: any, b: any) => a.daysLeft - b.daysLeft);

    const totalFlags =
      paymentOverdue.length +
      invoiceOverdue.length +
      overBudget.length +
      unassigned.length +
      wentQuiet.length +
      finishingSoon.length;

    res.json({
      activeCount,
      portfolioCount: projects.length,
      allClear: totalFlags === 0,
      groups: { invoiceOverdue, paymentOverdue, overBudget, unassigned, wentQuiet, finishingSoon },
    });
  }),
);

export default router;
