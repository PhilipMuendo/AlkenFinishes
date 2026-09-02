import { prisma } from '../lib/prisma';
import { getFinanceSettings, buildCategories, health } from './finance';
import { daysOverdue, invoiceBalanceCents, LIVE_INVOICE_STATUSES } from './invoicing';
import { toCents } from './money';

/**
 * The Overview digest: only the projects that need the owner's attention,
 * grouped by reason. Never a wall of metrics — just "what needs a decision".
 *
 * Extracted from the `/analytics/attention` route so the assistant's
 * `company_operations` lookup can ask the exact same question the Overview
 * page does. The route and the lookup must never disagree, so both call this.
 */

const DAY = 86_400_000;
export const QUIET_AFTER_DAYS = 4; // an active site with no report in this long has "gone quiet"
export const FINISHING_SOON_DAYS = 14;

export interface AttentionDigest {
  activeCount: number;
  portfolioCount: number;
  allClear: boolean;
  groups: {
    invoiceOverdue: {
      id: string;
      projectId: string;
      name: string;
      invoiceNo: string | null;
      clientName: string;
      balance: number;
      dueDate: Date;
      daysOverdue: number;
    }[];
    paymentOverdue: {
      id: string;
      name: string;
      pendingBalance: number;
      balanceDueDate: Date;
      daysOverdue: number;
    }[];
    overBudget: { id: string; name: string; consumedPct: number | null }[];
    unassigned: { id: string; name: string }[];
    wentQuiet: { id: string; name: string; lastReportAt: Date | null; daysSince: number | null }[];
    finishingSoon: { id: string; name: string; expectedCompletion: Date; daysLeft: number }[];
    pendingApprovals: {
      id: string;
      name: string;
      expenses: number;
      materialRequests: number;
      attendanceOverrides: number;
      total: number;
    }[];
  };
}

export async function attentionDigest(): Promise<AttentionDigest> {
  const settings = await getFinanceSettings();
  const now = Date.now();
  const [projects, budgetLines, expenseAgg, labourAgg, paymentAgg, dailyMax, weeklyMax] =
    await Promise.all([
      prisma.project.findMany({
        where: { status: { notIn: ['CANCELLED'] } },
        include: { supervisor: { select: { id: true, name: true } } },
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
  // Keyed by projectId, which is null for a company-wide expense — this
  // per-site digest has nowhere to show those, so that bucket is simply
  // never read (they surface on the Company Expenses tab instead).
  const expenseByProject = new Map<string | null, Record<string, number>>();
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

  const paymentOverdue: AttentionDigest['groups']['paymentOverdue'] = [];
  const overBudget: AttentionDigest['groups']['overBudget'] = [];
  const unassigned: AttentionDigest['groups']['unassigned'] = [];
  const wentQuiet: AttentionDigest['groups']['wentQuiet'] = [];
  const finishingSoon: AttentionDigest['groups']['finishingSoon'] = [];
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

  paymentOverdue.sort((a, b) => b.daysOverdue - a.daysOverdue);
  finishingSoon.sort((a, b) => a.daysLeft - b.daysLeft);

  // Things sitting on the owner's desk waiting for a yes/no — grouped by
  // project so "3 pending" points somewhere rather than being a bare count.
  const [expensePending, materialPending, overridePending] = await Promise.all([
    prisma.expense.groupBy({ by: ['projectId'], where: { status: 'PENDING' }, _count: true }),
    prisma.materialRequest.groupBy({ by: ['projectId'], where: { status: 'PENDING' }, _count: true }),
    prisma.attendanceOverrideRequest.groupBy({
      by: ['projectId'],
      where: { status: 'PENDING' },
      _count: true,
    }),
  ]);
  const pendingByProject = new Map<
    string,
    { expenses: number; materialRequests: number; attendanceOverrides: number }
  >();
  const bump = (
    rows: { projectId: string; _count: number }[],
    key: 'expenses' | 'materialRequests' | 'attendanceOverrides',
  ) => {
    for (const r of rows) {
      const e = pendingByProject.get(r.projectId) ?? { expenses: 0, materialRequests: 0, attendanceOverrides: 0 };
      e[key] = r._count;
      pendingByProject.set(r.projectId, e);
    }
  };
  // Company-wide expenses (projectId null) have no site to attach a pending
  // count to in this digest — they surface on the Company Expenses tab.
  bump(
    expensePending.filter((r): r is typeof r & { projectId: string } => r.projectId !== null),
    'expenses',
  );
  bump(materialPending, 'materialRequests');
  bump(overridePending, 'attendanceOverrides');
  const pendingApprovals = [...pendingByProject.entries()].map(([projectId, counts]) => ({
    id: projectId,
    name: projectNames.get(projectId) ?? '',
    ...counts,
    total: counts.expenses + counts.materialRequests + counts.attendanceOverrides,
  }));
  pendingApprovals.sort((a, b) => b.total - a.total);

  const totalFlags =
    paymentOverdue.length +
    invoiceOverdue.length +
    overBudget.length +
    unassigned.length +
    wentQuiet.length +
    finishingSoon.length +
    pendingApprovals.length;

  return {
    activeCount,
    portfolioCount: projects.length,
    allClear: totalFlags === 0,
    groups: {
      invoiceOverdue,
      paymentOverdue,
      overBudget,
      unassigned,
      wentQuiet,
      finishingSoon,
      pendingApprovals,
    },
  };
}
