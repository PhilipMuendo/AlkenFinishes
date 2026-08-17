import { prisma } from '../lib/prisma';
import { Prisma } from '@prisma/client';

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

export async function getFinanceSettings(): Promise<FinanceSettings> {
  const [t, l] = await Promise.all([
    prisma.setting.findUnique({ where: { key: 'budgetThresholds' } }),
    prisma.setting.findUnique({ where: { key: 'labourCostSource' } }),
  ]);
  const tv = (t?.value ?? {}) as Partial<Thresholds>;
  const lv = l?.value as LabourCostSource | undefined;
  return {
    thresholds: {
      yellowPct: tv.yellowPct ?? DEFAULT_THRESHOLDS.yellowPct,
      redPct: tv.redPct ?? DEFAULT_THRESHOLDS.redPct,
    },
    labourCostSource:
      lv === 'ATTENDANCE' || lv === 'EXPENSES' || lv === 'BOTH' ? lv : DEFAULT_LABOUR_SOURCE,
  };
}

export function health(
  consumedPct: number | null,
  t: Thresholds,
): 'GREEN' | 'YELLOW' | 'RED' | 'NONE' {
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
