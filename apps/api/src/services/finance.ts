import { prisma } from '../lib/prisma';
import { Prisma } from '@prisma/client';

export interface Thresholds {
  yellowPct: number; // consumption % at which category turns yellow
  redPct: number; // consumption % at which category turns red
}

export const DEFAULT_THRESHOLDS: Thresholds = { yellowPct: 80, redPct: 100 };

export async function getThresholds(): Promise<Thresholds> {
  const setting = await prisma.setting.findUnique({ where: { key: 'budgetThresholds' } });
  if (setting && typeof setting.value === 'object' && setting.value !== null) {
    const v = setting.value as Partial<Thresholds>;
    return {
      yellowPct: v.yellowPct ?? DEFAULT_THRESHOLDS.yellowPct,
      redPct: v.redPct ?? DEFAULT_THRESHOLDS.redPct,
    };
  }
  return DEFAULT_THRESHOLDS;
}

export function health(consumedPct: number | null, t: Thresholds): 'GREEN' | 'YELLOW' | 'RED' | 'NONE' {
  if (consumedPct === null) return 'NONE';
  if (consumedPct >= t.redPct) return 'RED';
  if (consumedPct >= t.yellowPct) return 'YELLOW';
  return 'GREEN';
}

const num = (d: Prisma.Decimal | number | null | undefined) => Number(d ?? 0);

export async function projectFinancials(projectId: string) {
  const [project, budgetLines, expenseAgg, labourAgg, thresholds] = await Promise.all([
    prisma.project.findUniqueOrThrow({ where: { id: projectId } }),
    prisma.budgetLine.findMany({ where: { projectId } }),
    prisma.expense.groupBy({
      by: ['category'],
      where: { projectId },
      _sum: { amount: true },
    }),
    prisma.attendanceRecord.aggregate({
      where: { projectId },
      _sum: { labourCost: true },
    }),
    getThresholds(),
  ]);

  const actualByCategory: Record<string, number> = {};
  for (const row of expenseAgg) actualByCategory[row.category] = num(row._sum.amount);
  // Biometric attendance labour cost counts as LABOUR actuals alongside labour expenses.
  const attendanceLabour = num(labourAgg._sum.labourCost);
  actualByCategory.LABOUR = (actualByCategory.LABOUR ?? 0) + attendanceLabour;

  const categories = (['MATERIALS', 'LABOUR', 'TRANSPORT', 'OTHER'] as const).map((category) => {
    const allocated = num(budgetLines.find((b) => b.category === category)?.allocated);
    const actual = actualByCategory[category] ?? 0;
    const consumedPct = allocated > 0 ? Math.round((actual / allocated) * 100) : null;
    return {
      category,
      allocated,
      actual,
      remaining: allocated - actual,
      consumedPct,
      health: health(consumedPct, thresholds),
    };
  });

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
    overallConsumedPct: overallPct,
    overallHealth: health(overallPct, thresholds),
    categories,
    thresholds,
  };
}
