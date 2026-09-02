import { prisma } from '../lib/prisma';
import { Prisma } from '@prisma/client';
import { env } from '../config/env';
import { companyReceivables } from './invoicing';

export interface Thresholds {
  yellowPct: number; // consumption % at which category turns yellow
  redPct: number; // consumption % at which category turns red
}

/**
 * How LABOUR actuals are computed. Wages flow into the system twice —
 * biometric attendance accrues cost, and cash payouts get logged as LABOUR
 * expenses. Counting both double-counts wages, so the owner picks one:
 *  - ATTENDANCE: labour = attendance-accrued cost only (recommended once
 *    devices are in use; record payouts under OTHER or as reconciliations)
 *  - EXPENSES: labour = labour expense entries only
 *  - BOTH: sum of both (legacy behavior; only correct if payouts are never
 *    logged as expenses)
 */
export type LabourCostSource = 'ATTENDANCE' | 'EXPENSES' | 'BOTH';

// BOTH is the conservative default: it can only overstate costs (never
// profit). Owners switch to ATTENDANCE in Settings once devices are live.
export const DEFAULT_THRESHOLDS: Thresholds = { yellowPct: 80, redPct: 100 };
export const DEFAULT_LABOUR_SOURCE: LabourCostSource = 'BOTH';

export interface FinanceSettings {
  thresholds: Thresholds;
  labourCostSource: LabourCostSource;
}

/**
 * Two rows that change a few times a year, read on nearly every request.
 *
 * `projectFinancials` calls this, and the dashboard calls that once per site —
 * so an eight-site overview was doing sixteen queries for two values that had
 * not moved since the owner last opened Settings. Cached for a minute, and
 * cleared outright when either row is written, so a threshold change shows up
 * on the next screen rather than a minute later.
 */
const SETTINGS_TTL_MS = 60_000;
let settingsCache: { at: number; value: FinanceSettings } | null = null;

/** Called by the settings routes after either row is saved. */
export function clearFinanceSettingsCache() {
  settingsCache = null;
}

export async function getFinanceSettings(): Promise<FinanceSettings> {
  if (settingsCache && Date.now() - settingsCache.at < SETTINGS_TTL_MS) {
    return settingsCache.value;
  }
  const [t, l] = await Promise.all([
    prisma.setting.findUnique({ where: { key: 'budgetThresholds' } }),
    prisma.setting.findUnique({ where: { key: 'labourCostSource' } }),
  ]);
  const tv = (t?.value ?? {}) as Partial<Thresholds>;
  const lv = l?.value as LabourCostSource | undefined;
  const value: FinanceSettings = {
    thresholds: {
      yellowPct: tv.yellowPct ?? DEFAULT_THRESHOLDS.yellowPct,
      redPct: tv.redPct ?? DEFAULT_THRESHOLDS.redPct,
    },
    labourCostSource:
      lv === 'ATTENDANCE' || lv === 'EXPENSES' || lv === 'BOTH' ? lv : DEFAULT_LABOUR_SOURCE,
  };
  settingsCache = { at: Date.now(), value };
  return value;
}

export function health(consumedPct: number | null, t: Thresholds): 'GREEN' | 'YELLOW' | 'RED' | 'NONE' {
  if (consumedPct === null) return 'NONE';
  if (consumedPct >= t.redPct) return 'RED';
  if (consumedPct >= t.yellowPct) return 'YELLOW';
  return 'GREEN';
}

const num = (d: Prisma.Decimal | number | null | undefined) => Number(d ?? 0);

export interface CategoryActuals {
  expenseByCategory: Record<string, number>;
  attendanceLabour: number;
}

export function buildCategories(
  budgetLines: { category: string; allocated: Prisma.Decimal | number }[],
  actuals: CategoryActuals,
  settings: FinanceSettings,
) {
  const actualByCategory = { ...actuals.expenseByCategory };
  if (settings.labourCostSource === 'ATTENDANCE') {
    actualByCategory.LABOUR = actuals.attendanceLabour;
  } else if (settings.labourCostSource === 'BOTH') {
    actualByCategory.LABOUR = (actualByCategory.LABOUR ?? 0) + actuals.attendanceLabour;
  } // EXPENSES: leave expense-derived labour as-is

  return (['MATERIALS', 'LABOUR', 'TRANSPORT', 'OTHER'] as const).map((category) => {
    const allocated = num(budgetLines.find((b) => b.category === category)?.allocated);
    const actual = actualByCategory[category] ?? 0;
    const consumedPct = allocated > 0 ? Math.round((actual / allocated) * 100) : null;
    return {
      category,
      allocated,
      actual,
      remaining: allocated - actual,
      consumedPct,
      health: health(consumedPct, settings.thresholds),
    };
  });
}

export async function projectFinancials(projectId: string, settings?: FinanceSettings) {
  const fin = settings ?? (await getFinanceSettings());
  const [project, budgetLines, expenseAgg, labourAgg] = await Promise.all([
    prisma.project.findUniqueOrThrow({ where: { id: projectId } }),
    prisma.budgetLine.findMany({ where: { projectId } }),
    // Only APPROVED expenses are actual spend. A PENDING claim is real money
    // that left someone's hand on site, but it has not yet been accepted as
    // a cost — counting it here would let an unreviewed claim move a budget
    // into the red before anyone has looked at it.
    prisma.expense.groupBy({
      by: ['category'],
      where: { projectId, status: 'APPROVED' },
      _sum: { amount: true },
    }),
    prisma.attendanceRecord.aggregate({
      where: { projectId },
      _sum: { labourCost: true },
    }),
  ]);

  const expenseByCategory: Record<string, number> = {};
  for (const row of expenseAgg) expenseByCategory[row.category] = num(row._sum.amount);
  const attendanceLabour = num(labourAgg._sum.labourCost);

  const categories = buildCategories(budgetLines, { expenseByCategory, attendanceLabour }, fin);

  const totalBudget = categories.reduce((s, c) => s + c.allocated, 0);
  const totalActual = categories.reduce((s, c) => s + c.actual, 0);
  const contractValue = num(project.contractValue);
  const overallPct = totalBudget > 0 ? Math.round((totalActual / totalBudget) * 100) : null;

  return {
    projectId,
    contractValue,
    totalBudget,
    totalActual,
    totalRemaining: totalBudget - totalActual,
    estimatedProfit: contractValue - totalActual,
    attendanceLabourCost: attendanceLabour,
    labourCostSource: fin.labourCostSource,
    overallConsumedPct: overallPct,
    overallHealth: health(overallPct, fin.thresholds),
    categories,
    thresholds: fin.thresholds,
  };
}

export interface ProjectFinancialsRow {
  id: string;
  name: string;
  contractValue: number;
  totalBudget: number;
  totalActual: number;
  estimatedProfit: number;
  consumedPct: number | null;
  health: ReturnType<typeof health>;
  totalCollected: number;
  pendingBalance: number;
}

export interface CompanyFinancials {
  totals: {
    contractValue: number;
    totalBudget: number;
    totalActual: number;
    estimatedProfit: number;
    totalCollected: number;
    totalPendingBalance: number;
    arOutstanding: number;
    arOverdue: number;
    retentionHeld: number;
    overallConsumedPct: number | null;
    overallHealth: ReturnType<typeof health>;
    /** Approved spend on Expense rows with no projectId — uniforms, office
     * supplies, and the like. Already folded into totalActual/estimatedProfit
     * above; broken out here so it reads as its own line rather than a site's. */
    unassignedExpenses: number;
  };
  projects: ProjectFinancialsRow[];
}

/**
 * The company's financial position across every non-cancelled site: contract
 * value, spend, and the profit implied by the two — the same figures
 * `projectFinancials` returns for one site, rolled up.
 *
 * Extracted from the `/analytics/company` route (rather than the route
 * calling this and the chat lookup hand-rolling its own version) so a
 * profitability question from the assistant can never disagree with the
 * Overview dashboard — they are, literally, the same arithmetic. Fixed
 * number of grouped queries regardless of how many sites or rows exist.
 */
export async function companyFinancials(
  settings?: FinanceSettings,
): Promise<CompanyFinancials> {
  const fin = settings ?? (await getFinanceSettings());
  const since30d = new Date(Date.now() - 30 * 86400_000);
  const [projects, budgetLines, expenseAgg, labourAgg, paymentAgg] = await Promise.all([
    prisma.project.findMany({
      where: { status: { notIn: ['CANCELLED'] } },
      select: { id: true, name: true, contractValue: true },
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
    // voidedAt: null — a voided receipt is not money received. Omitting this
    // filter silently overstates collections across the dashboard.
    prisma.payment.groupBy({
      by: ['projectId'],
      where: { voidedAt: null },
      _sum: { amount: true },
    }),
  ]);

  // Keyed by projectId, which for a company-wide expense is null — see
  // unassignedActual below, which is the one place that bucket is read.
  const expenseByProject = new Map<string | null, Record<string, number>>();
  for (const row of expenseAgg) {
    const bucket = expenseByProject.get(row.projectId) ?? {};
    bucket[row.category] = num(row._sum.amount);
    expenseByProject.set(row.projectId, bucket);
  }
  const labourByProject = new Map(labourAgg.map((a) => [a.projectId, num(a._sum.labourCost)]));
  const collectedByProject = new Map(paymentAgg.map((a) => [a.projectId, num(a._sum.amount)]));
  const budgetLinesByProject = new Map<string, typeof budgetLines>();
  for (const line of budgetLines) {
    const bucket = budgetLinesByProject.get(line.projectId) ?? [];
    bucket.push(line);
    budgetLinesByProject.set(line.projectId, bucket);
  }

  const rows: ProjectFinancialsRow[] = projects.map((p) => {
    const categories = buildCategories(
      budgetLinesByProject.get(p.id) ?? [],
      { expenseByCategory: expenseByProject.get(p.id) ?? {}, attendanceLabour: labourByProject.get(p.id) ?? 0 },
      fin,
    );
    const totalBudget = categories.reduce((s, c) => s + c.allocated, 0);
    const totalActual = categories.reduce((s, c) => s + c.actual, 0);
    const contractValue = num(p.contractValue);
    const consumedPct = totalBudget > 0 ? Math.round((totalActual / totalBudget) * 100) : null;
    const totalCollected = collectedByProject.get(p.id) ?? 0;
    return {
      id: p.id,
      name: p.name,
      contractValue,
      totalBudget,
      totalActual,
      estimatedProfit: contractValue - totalActual,
      consumedPct,
      health: health(consumedPct, fin.thresholds),
      totalCollected,
      pendingBalance: contractValue - totalCollected,
    };
  });

  const perProjectTotals = rows.reduce(
    (acc, p) => ({
      contractValue: acc.contractValue + p.contractValue,
      totalBudget: acc.totalBudget + p.totalBudget,
      totalActual: acc.totalActual + p.totalActual,
      estimatedProfit: acc.estimatedProfit + p.estimatedProfit,
      totalCollected: acc.totalCollected + p.totalCollected,
    }),
    { contractValue: 0, totalBudget: 0, totalActual: 0, estimatedProfit: 0, totalCollected: 0 },
  );

  // Approved spend with no project attached at all — a per-project reduce
  // never sees it, so it is added back in explicitly rather than left to
  // silently vanish from the company-wide totals.
  const unassignedExpenses = Object.values(expenseByProject.get(null) ?? {}).reduce(
    (s, v) => s + v,
    0,
  );
  const totals = {
    ...perProjectTotals,
    totalActual: perProjectTotals.totalActual + unassignedExpenses,
    estimatedProfit: perProjectTotals.estimatedProfit - unassignedExpenses,
  };
  const overallConsumedPct =
    totals.totalBudget > 0 ? Math.round((totals.totalActual / totals.totalBudget) * 100) : null;

  const receivables = await companyReceivables(rows.map((p) => p.id));

  return {
    totals: {
      ...totals,
      totalPendingBalance: totals.contractValue - totals.totalCollected,
      arOutstanding: receivables.totalAr,
      arOverdue: receivables.totalOverdue,
      retentionHeld: receivables.retentionHeld,
      overallConsumedPct,
      overallHealth: health(overallConsumedPct, fin.thresholds),
      unassignedExpenses,
    },
    projects: rows,
  };
}

interface MonthRow {
  month: string;
  category: string;
  total: number;
}

/**
 * Monthly spend by category, aggregated in SQL (timezone-aware), never by
 * loading rows into the app. Cost is O(distinct months × categories)
 * regardless of volume. Company-wide when `projectIds` is omitted.
 */
export async function monthlyTotals(
  labourCostSource: LabourCostSource,
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

export interface ExpenseSeriesRow {
  month: string;
  MATERIALS: number;
  LABOUR: number;
  TRANSPORT: number;
  OTHER: number;
  total: number;
  cumulative: number;
}

export function toSeries(rows: MonthRow[]): ExpenseSeriesRow[] {
  const byMonth = new Map<string, ExpenseSeriesRow>();
  for (const r of rows) {
    if (!byMonth.has(r.month)) {
      byMonth.set(r.month, { month: r.month, MATERIALS: 0, LABOUR: 0, TRANSPORT: 0, OTHER: 0, total: 0, cumulative: 0 });
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
