/**
 * How far through the works a project is.
 *
 * Progress used to be the plain mean of task completion, which made every task
 * count the same: "second coat to the whole block" moved the project as much as
 * "fit one door stop", and adding ten trivial tasks quietly diluted the figure.
 * Every number downstream inherited that — the programme card, planned-vs-actual,
 * and the projected finish date in insights.ts.
 *
 * Tasks now carry a weight. The recommended weight is the task's value from the
 * priced schedule, because that is what a progress claim is measured on, but any
 * consistent relative size works (planned days, area, crew-days).
 *
 * Weight defaults to 1, so a project where nobody has set weights produces
 * exactly the mean it produced before. This is deliberate: turning the feature on
 * must not silently move anybody's reported progress.
 */

export interface WeightedTask {
  /** 0–100. */
  completionPct: number;
  /** Relative size. Non-positive weights are ignored, not treated as zero-size. */
  weight: number;
}

export interface ProgressResult {
  /** The figure to report, 0–100. */
  pct: number;
  /** What the old plain mean would have said — for showing the difference. */
  unweightedPct: number;
  /**
   * True when the weights actually differ from one another. All-equal weights
   * (including the all-default case) are mathematically identical to the mean,
   * and calling that "weighted" would overstate what the number knows.
   */
  weighted: boolean;
  totalWeight: number;
  taskCount: number;
  /**
   * Tasks still sitting on the default weight of 1 while others carry a real
   * one. A task worth 1 next to tasks worth 500,000 is invisible, so a
   * half-finished weighting job is more misleading than none at all.
   */
  unweightedTaskCount: number;
}

const DEFAULT_WEIGHT = 1;
const clampPct = (n: number) => Math.min(100, Math.max(0, n));

export function weightedProgress(tasks: WeightedTask[]): ProgressResult {
  const count = tasks.length;
  if (count === 0) {
    return {
      pct: 0,
      unweightedPct: 0,
      weighted: false,
      totalWeight: 0,
      taskCount: 0,
      unweightedTaskCount: 0,
    };
  }

  const unweightedPct = Math.round(
    tasks.reduce((s, t) => s + clampPct(t.completionPct), 0) / count,
  );

  // A zero or negative weight is bad data, not a claim that the task is
  // weightless — dropping it beats letting it drag the total toward zero.
  const usable = tasks.filter((t) => t.weight > 0);
  const totalWeight = usable.reduce((s, t) => s + t.weight, 0);

  if (usable.length === 0 || totalWeight <= 0) {
    return {
      pct: unweightedPct,
      unweightedPct,
      weighted: false,
      totalWeight: 0,
      taskCount: count,
      unweightedTaskCount: count,
    };
  }

  const weightedSum = usable.reduce((s, t) => s + clampPct(t.completionPct) * t.weight, 0);
  const pct = Math.round(weightedSum / totalWeight);

  const distinct = new Set(usable.map((t) => t.weight));
  const unweightedTaskCount = tasks.filter((t) => t.weight === DEFAULT_WEIGHT).length;

  return {
    pct,
    unweightedPct,
    weighted: distinct.size > 1,
    totalWeight,
    taskCount: count,
    // Only meaningful once somebody has started weighting; on an all-default
    // project every task is "unweighted" and saying so would be noise.
    unweightedTaskCount: distinct.size > 1 ? unweightedTaskCount : 0,
  };
}
