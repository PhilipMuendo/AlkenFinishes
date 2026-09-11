import { prisma } from '../lib/prisma';
import { projectFinancials } from './finance';
import { getCompanyProfile } from './invoicing';
import { weightedProgress } from './progress';
import { gatherWeek, weekBounds } from './weeklyReportDraft';
import { renderReportPdf, type ReportSection, type SummaryLine } from './documents/reportPdf';
import { printDate } from './pdf';

/**
 * Weekly Planned vs Actual — "where does this site stand, right now, against
 * what was planned" — generated fresh each week rather than restated for a
 * past one. Quantities, % completion, labour, materials and money are all
 * TO-DATE figures (the same convention `projectFinancials` already uses,
 * which has no date filter at all): a supervisor filing this week's report
 * wants "500 m² planned, 450 done so far", not "450 done in the last seven
 * days". Only the programme/outstanding-work section is scoped to the week
 * itself, via `gatherWeek`/`weekBounds` — the same facts the AI weekly-report
 * draft already gathers, just re-presented as a table instead of prose.
 */

export interface QuantityRow {
  item: string; // "Painting — Bedroom 1" (phase — name)
  unit: string;
  planned: number;
  actual: number;
  variance: number;
}

export interface WeeklyProgressData {
  weekEnding: string;
  quantities: QuantityRow[];
  completion: {
    overallPct: number;
    byPhase: { phase: string; pct: number }[];
  };
  labour: {
    plannedDays: number | null;
    actualDays: number;
    variance: number | null;
  };
  materials: { planned: number; actual: number; variance: number };
  money: { planned: number; actual: number; variance: number };
  programme: {
    tasksCompletedThisWeek: string[];
    snagsRaisedThisWeek: number;
    snagsResolvedThisWeek: number;
    daysReportedThisWeek: number;
  };
  outstandingWork: { phase: string; name: string; status: string; completionPct: number }[];
}

export async function computeWeeklyProgress(
  projectId: string,
  weekEnding: Date,
): Promise<WeeklyProgressData> {
  const [tasks, fin, labourDaysActual, week] = await Promise.all([
    prisma.task.findMany({
      where: { projectId },
      select: {
        phase: true,
        name: true,
        status: true,
        completionPct: true,
        weight: true,
        plannedQuantity: true,
        actualQuantity: true,
        unit: true,
      },
      orderBy: [{ phase: 'asc' }, { sortOrder: 'asc' }],
    }),
    projectFinancials(projectId),
    // One AttendanceRecord row is one worker on one day, so a count of
    // completed (costed) rows is exactly the man-days worked — no separate
    // "planned" figure is needed on the actual side, only the budget line's.
    prisma.attendanceRecord.count({ where: { projectId, labourCost: { not: null } } }),
    gatherWeek(projectId, weekEnding),
  ]);

  const materialsLine = fin.categories.find((c) => c.category === 'MATERIALS');

  const budgetLine = await prisma.budgetLine.findUnique({
    where: { projectId_category: { projectId, category: 'LABOUR' } },
    select: { plannedLabourDays: true },
  });
  const plannedDays = budgetLine?.plannedLabourDays != null ? Number(budgetLine.plannedLabourDays) : null;

  const quantities: QuantityRow[] = tasks
    .filter((t) => t.plannedQuantity != null)
    .map((t) => {
      const planned = Number(t.plannedQuantity);
      const actual = Number(t.actualQuantity ?? 0);
      return {
        item: `${t.phase} — ${t.name}`,
        unit: t.unit ?? '',
        planned,
        actual,
        variance: actual - planned,
      };
    });

  const byPhaseMap = new Map<string, { completionPct: number; weight: number }[]>();
  for (const t of tasks) {
    const list = byPhaseMap.get(t.phase) ?? [];
    list.push({ completionPct: t.completionPct, weight: Number(t.weight) });
    byPhaseMap.set(t.phase, list);
  }
  const byPhase = [...byPhaseMap.entries()].map(([phase, list]) => ({
    phase,
    pct: weightedProgress(list).pct,
  }));
  const overallPct = weightedProgress(
    tasks.map((t) => ({ completionPct: t.completionPct, weight: Number(t.weight) })),
  ).pct;

  return {
    weekEnding: weekEnding.toISOString().slice(0, 10),
    quantities,
    completion: { overallPct, byPhase },
    labour: {
      plannedDays,
      actualDays: labourDaysActual,
      variance: plannedDays != null ? labourDaysActual - plannedDays : null,
    },
    materials: {
      planned: materialsLine?.allocated ?? 0,
      actual: materialsLine?.actual ?? 0,
      variance: (materialsLine?.actual ?? 0) - (materialsLine?.allocated ?? 0),
    },
    money: {
      planned: fin.totalBudget,
      actual: fin.totalActual,
      variance: fin.totalActual - fin.totalBudget,
    },
    programme: {
      tasksCompletedThisWeek: week.tasksCompleted,
      snagsRaisedThisWeek: week.snagsRaised,
      snagsResolvedThisWeek: week.snagsResolved,
      daysReportedThisWeek: week.daysReported,
    },
    outstandingWork: tasks
      .filter((t) => t.status !== 'DONE')
      .map((t) => ({ phase: t.phase, name: t.name, status: t.status, completionPct: t.completionPct })),
  };
}

/** Re-exported so callers building the weekly-progress route don't need a second import from weeklyReportDraft. */
export { weekBounds };

/**
 * The variance table as a printable PDF — Item / Planned / Actual / Variance,
 * matching the layout the client asked for. `renderReportPdf` fits directly:
 * this is an internal progress report with no signature or fixed legal
 * convention, the same class of document as the business-reports pack.
 */
export async function renderWeeklyProgressPdf(
  projectName: string,
  data: WeeklyProgressData,
): Promise<string> {
  const company = await getCompanyProfile();
  const row = (item: string, unit: string, planned: number, actual: number) => [
    item,
    unit,
    planned,
    actual,
    actual - planned,
  ];

  const sections: ReportSection[] = [
    {
      heading: 'Quantities',
      columns: [
        { header: 'Item' },
        { header: 'Unit' },
        { header: 'Planned', align: 'right' },
        { header: 'Actual', align: 'right' },
        { header: 'Variance', align: 'right' },
      ],
      rows: data.quantities.map((q) => row(q.item, q.unit, q.planned, q.actual)),
    },
    {
      heading: 'Labour, materials & money',
      columns: [
        { header: 'Item' },
        { header: 'Planned', align: 'right' },
        { header: 'Actual', align: 'right' },
        { header: 'Variance', align: 'right' },
      ],
      moneyColumns: [1, 2, 3],
      rows: [
        [
          'Labour (days)',
          data.labour.plannedDays ?? '—',
          data.labour.actualDays,
          data.labour.variance ?? '—',
        ],
      ],
    },
    {
      columns: [
        { header: 'Item' },
        { header: 'Planned', align: 'right' },
        { header: 'Actual', align: 'right' },
        { header: 'Variance', align: 'right' },
      ],
      moneyColumns: [1, 2, 3],
      rows: [
        ['Materials (KES)', data.materials.planned, data.materials.actual, data.materials.variance],
        ['Total spend (KES)', data.money.planned, data.money.actual, data.money.variance],
      ],
    },
    {
      heading: 'Outstanding work',
      columns: [{ header: 'Phase' }, { header: 'Task' }, { header: 'Status' }, { header: '% complete', align: 'right' }],
      rows: data.outstandingWork.map((t) => [t.phase, t.name, t.status.replace('_', ' '), t.completionPct]),
    },
  ];

  const summary: SummaryLine[] = [
    { label: 'Overall completion', value: `${data.completion.overallPct}%`, emphasis: true },
    { label: 'Days reported this week', value: `${data.programme.daysReportedThisWeek} of 7` },
    { label: 'Tasks completed this week', value: `${data.programme.tasksCompletedThisWeek.length}` },
    {
      label: 'Snags this week',
      value: `${data.programme.snagsRaisedThisWeek} raised, ${data.programme.snagsResolvedThisWeek} resolved`,
    },
  ];

  return renderReportPdf({
    title: 'Weekly Progress',
    subtitle: 'Planned vs Actual',
    company,
    generatedFor: `${projectName} · Week ending ${printDate(new Date(data.weekEnding))}`,
    sections,
    summary,
  });
}
