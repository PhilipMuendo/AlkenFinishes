/**
 * The recommendation engine behind the Command Centre's Insights card.
 *
 * Deterministic rules over figures the rest of the system already computes —
 * no model call, no network. That is a deliberate choice, not a placeholder:
 * every line an owner reads here is a number they can go and check, the same
 * input always produces the same output, and it keeps working on a site with
 * no connectivity. A rule that cannot be justified from the data does not fire.
 *
 * Rules are pure. Everything time-dependent arrives through `today` so the
 * output is reproducible and testable.
 */

export type InsightSeverity = 'CRITICAL' | 'WARNING' | 'INFO' | 'GOOD';

export interface Insight {
  /** Stable identifier for the rule, so the UI can key and test can assert. */
  id: string;
  severity: InsightSeverity;
  /** The finding, stated as a fact. */
  message: string;
  /** What to do about it. Omitted when there is nothing useful to suggest. */
  action?: string;
  /** True when the message discloses money. Stripped for supervisors. */
  financial?: boolean;
}

export interface InsightInput {
  today: Date;
  status: string;
  startDate: Date;
  expectedCompletion: Date;
  /** 0–100, as recorded against the programme. */
  progressPct: number;
  supervisorAssigned: boolean;
  /** Days since the last daily/weekly report; null when there has never been one. */
  daysSinceLastReport: number | null;

  budget: {
    totalBudget: number;
    totalActual: number;
    consumedPct: number | null;
  };
  invoices: {
    outstanding: number;
    overdue: number;
    overdueCount: number;
    oldestOverdueDays: number;
  };
  snags: {
    open: number;
    overdue: number;
    highOpen: number;
    rework: number;
  };
  attendance: {
    assigned: number;
    present: number;
  };
  equipment: {
    down: number;
    serviceOverdue: number;
  };
  safety: {
    seriousLast30d: number;
    totalLast30d: number;
  };
}

const DAY = 86_400_000;
const days = (ms: number) => Math.round(ms / DAY);

/** Spend may run this far ahead of progress before it is worth mentioning. */
const SPEND_AHEAD_TOLERANCE_PCT = 10;
/** Below this much elapsed programme, a completion projection is noise. */
const MIN_ELAPSED_DAYS_FOR_PROJECTION = 7;
/** Slip smaller than this is inside the noise of a hand-entered progress %. */
const MIN_SLIP_DAYS_TO_REPORT = 2;

/**
 * Projected finish date from the rate of progress achieved so far.
 *
 * Linear extrapolation, which is the honest model for a hand-entered progress
 * percentage — anything more elaborate would imply a precision the input does
 * not have. Returns null when the programme has not run long enough, or when
 * no progress has been recorded, because dividing by either produces a
 * confident-looking number backed by nothing.
 */
export function projectCompletion(input: InsightInput): {
  plannedPct: number;
  elapsedDays: number;
  totalDays: number;
  projectedFinish: Date;
  slipDays: number;
} | null {
  const totalDays = days(input.expectedCompletion.getTime() - input.startDate.getTime());
  const elapsedDays = days(input.today.getTime() - input.startDate.getTime());
  if (totalDays <= 0 || elapsedDays < MIN_ELAPSED_DAYS_FOR_PROJECTION) return null;
  if (input.progressPct <= 0) return null;

  const plannedPct = Math.min(100, Math.round((elapsedDays / totalDays) * 100));
  const pctPerDay = input.progressPct / elapsedDays;
  const projectedTotalDays = Math.round(100 / pctPerDay);
  const projectedFinish = new Date(input.startDate.getTime() + projectedTotalDays * DAY);
  const slipDays = projectedTotalDays - totalDays;

  return { plannedPct, elapsedDays, totalDays, projectedFinish, slipDays };
}

const pct = (n: number) => `${Math.round(n)}%`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Every rule, in the order they are evaluated. Output is then sorted by
 * severity so the worst news is first regardless of definition order.
 */
type Rule = (i: InsightInput) => Insight | null;

const scheduleProjection: Rule = (i) => {
  const p = projectCompletion(i);
  if (!p) return null;

  if (p.slipDays >= MIN_SLIP_DAYS_TO_REPORT) {
    return {
      id: 'schedule.slipping',
      severity: p.slipDays > 14 ? 'CRITICAL' : 'WARNING',
      message: `At the current rate of progress, this project is projected to finish ${plural(p.slipDays, 'day')} late.`,
      action: `${pct(i.progressPct)} done against ${pct(p.plannedPct)} planned — recover about ${pct(p.plannedPct - i.progressPct)} to get back on programme.`,
    };
  }
  if (p.slipDays <= -MIN_SLIP_DAYS_TO_REPORT) {
    return {
      id: 'schedule.ahead',
      severity: 'GOOD',
      message: `Ahead of programme — projected to finish ${plural(Math.abs(p.slipDays), 'day')} early.`,
    };
  }
  return {
    id: 'schedule.onTrack',
    severity: 'GOOD',
    message: `On programme — ${pct(i.progressPct)} complete against ${pct(p.plannedPct)} planned.`,
  };
};

const spendAheadOfProgress: Rule = (i) => {
  const consumed = i.budget.consumedPct;
  if (consumed == null || i.budget.totalBudget <= 0) return null;
  // Only meaningful once there is progress to compare against; at 0% done any
  // spend at all is trivially "ahead".
  if (i.progressPct <= 0) return null;
  const gap = consumed - i.progressPct;
  if (gap <= SPEND_AHEAD_TOLERANCE_PCT) return null;
  return {
    id: 'budget.spendAheadOfProgress',
    severity: consumed >= 100 ? 'CRITICAL' : 'WARNING',
    financial: true,
    message: `${pct(consumed)} of the budget is spent for ${pct(i.progressPct)} of the work.`,
    action:
      consumed >= 100
        ? 'The budget is exhausted before completion — review the remaining scope against what is left to spend.'
        : 'Check whether the remaining work can be finished inside the remaining budget.',
  };
};

const overdueInvoices: Rule = (i) => {
  if (i.invoices.overdueCount === 0) return null;
  return {
    id: 'invoices.overdue',
    severity: i.invoices.oldestOverdueDays > 30 ? 'CRITICAL' : 'WARNING',
    financial: true,
    message: `${plural(i.invoices.overdueCount, 'invoice')} overdue, the oldest by ${plural(i.invoices.oldestOverdueDays, 'day')}.`,
    action: 'Follow up with the client before issuing the next claim.',
  };
};

const overdueSnags: Rule = (i) => {
  if (i.snags.overdue === 0) return null;
  return {
    id: 'snags.overdue',
    severity: i.snags.overdue >= 5 ? 'CRITICAL' : 'WARNING',
    message: `${plural(i.snags.overdue, 'defect')} past the agreed fix date.`,
    action: 'Handing over with these open invites a retention dispute.',
  };
};

const repeatedRework: Rule = (i) => {
  if (i.snags.rework < 2) return null;
  return {
    id: 'snags.rework',
    severity: 'WARNING',
    message: `Defects on this site have been sent back for rework ${plural(i.snags.rework, 'time')}.`,
    action: 'Repeated rework usually points at one trade or one detail — worth checking which.',
  };
};

const highSeverityDefects: Rule = (i) => {
  if (i.snags.highOpen === 0) return null;
  return {
    id: 'snags.highSeverity',
    severity: 'WARNING',
    message: `${plural(i.snags.highOpen, 'high-severity defect')} still open.`,
  };
};

const seriousSafety: Rule = (i) => {
  if (i.safety.seriousLast30d === 0) return null;
  return {
    id: 'safety.serious',
    severity: 'CRITICAL',
    message: `${plural(i.safety.seriousLast30d, 'serious safety incident')} in the last 30 days.`,
    action: 'Review the method statement for the activity involved before work continues.',
  };
};

const equipmentDown: Rule = (i) => {
  if (i.equipment.down === 0) return null;
  return {
    id: 'equipment.down',
    severity: 'WARNING',
    message: `${plural(i.equipment.down, 'item')} of equipment on this site ${i.equipment.down === 1 ? 'is' : 'are'} out of service.`,
    action: 'Confirm the work depending on it has an alternative, or it will show up as lost days.',
  };
};

const equipmentServiceOverdue: Rule = (i) => {
  if (i.equipment.serviceOverdue === 0) return null;
  return {
    id: 'equipment.serviceOverdue',
    severity: 'INFO',
    message: `${plural(i.equipment.serviceOverdue, 'item')} of equipment ${i.equipment.serviceOverdue === 1 ? 'is' : 'are'} past ${i.equipment.serviceOverdue === 1 ? 'its' : 'their'} service date.`,
  };
};

const attendanceShortfall: Rule = (i) => {
  // Only a signal on a site that has a roster and has been opened today.
  if (i.attendance.assigned === 0 || i.attendance.present === 0) return null;
  const absent = i.attendance.assigned - i.attendance.present;
  if (absent <= 0) return null;
  const absentPct = (absent / i.attendance.assigned) * 100;
  if (absentPct < 25) return null;
  return {
    id: 'attendance.shortfall',
    severity: absentPct >= 50 ? 'WARNING' : 'INFO',
    message: `${plural(absent, 'assigned worker')} of ${i.attendance.assigned} did not check in today.`,
    action: 'A thin crew today is tomorrow’s slipped programme.',
  };
};

const siteWentQuiet: Rule = (i) => {
  if (i.status !== 'ACTIVE') return null;
  if (i.daysSinceLastReport == null) {
    return {
      id: 'reporting.never',
      severity: 'WARNING',
      message: 'No site report has ever been submitted for this project.',
      action: 'Without daily reports the figures on this page have nothing to corroborate them.',
    };
  }
  if (i.daysSinceLastReport <= 3) return null;
  return {
    id: 'reporting.quiet',
    severity: i.daysSinceLastReport > 7 ? 'WARNING' : 'INFO',
    message: `No site report for ${plural(i.daysSinceLastReport, 'day')}.`,
  };
};

const noSupervisor: Rule = (i) => {
  if (i.status !== 'ACTIVE' || i.supervisorAssigned) return null;
  return {
    id: 'staffing.noSupervisor',
    severity: 'CRITICAL',
    message: 'This site is active with no supervisor assigned.',
    action: 'Nobody can submit reports, attendance or defects until someone is assigned.',
  };
};

const RULES: Rule[] = [
  noSupervisor,
  seriousSafety,
  scheduleProjection,
  spendAheadOfProgress,
  overdueInvoices,
  overdueSnags,
  highSeverityDefects,
  repeatedRework,
  equipmentDown,
  attendanceShortfall,
  siteWentQuiet,
  equipmentServiceOverdue,
];

const SEVERITY_ORDER: Record<InsightSeverity, number> = {
  CRITICAL: 0,
  WARNING: 1,
  INFO: 2,
  GOOD: 3,
};

/**
 * Runs every rule and returns what fired, worst first.
 *
 * `includeFinancial: false` drops money-disclosing insights entirely rather
 * than blanking their numbers — a supervisor seeing "the budget is exhausted"
 * with the figure removed has still been told the thing they are not meant to
 * know.
 */
export function buildInsights(
  input: InsightInput,
  opts: { includeFinancial?: boolean } = {},
): Insight[] {
  const includeFinancial = opts.includeFinancial ?? true;
  const fired = RULES.map((rule) => rule(input)).filter((r): r is Insight => r !== null);
  const visible = includeFinancial ? fired : fired.filter((r) => !r.financial);
  return visible.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
