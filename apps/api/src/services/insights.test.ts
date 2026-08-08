import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInsights, projectCompletion, type InsightInput } from './insights';

const DAY = 86_400_000;

/** A project halfway through its programme with nothing wrong. */
function baseInput(over: Partial<InsightInput> = {}): InsightInput {
  const start = new Date('2026-01-01T00:00:00Z');
  return {
    today: new Date('2026-03-02T00:00:00Z'), // 60 days in
    status: 'ACTIVE',
    startDate: start,
    expectedCompletion: new Date('2026-05-01T00:00:00Z'), // 120-day programme
    progressPct: 50,
    supervisorAssigned: true,
    daysSinceLastReport: 1,
    budget: { totalBudget: 1_000_000, totalActual: 500_000, consumedPct: 50 },
    invoices: { outstanding: 0, overdue: 0, overdueCount: 0, oldestOverdueDays: 0 },
    snags: { open: 0, overdue: 0, highOpen: 0, rework: 0 },
    attendance: { assigned: 10, present: 10 },
    equipment: { down: 0, serviceOverdue: 0 },
    safety: { seriousLast30d: 0, totalLast30d: 0 },
    ...over,
  };
}

const ids = (i: ReturnType<typeof buildInsights>) => i.map((x) => x.id);

test('projectCompletion: on-programme work projects no slip', () => {
  const p = projectCompletion(baseInput());
  assert.ok(p);
  assert.equal(p.plannedPct, 50);
  assert.equal(p.slipDays, 0);
});

test('projectCompletion: half the expected rate projects double the duration', () => {
  // 60 days elapsed of a 120-day job, but only 25% done: 0.4167%/day means
  // 240 days to reach 100%, i.e. 120 days late.
  const p = projectCompletion(baseInput({ progressPct: 25 }));
  assert.ok(p);
  assert.equal(p.slipDays, 120);
});

test('projectCompletion: refuses to guess without enough elapsed programme', () => {
  const start = new Date('2026-01-01T00:00:00Z');
  const p = projectCompletion(
    baseInput({ startDate: start, today: new Date(start.getTime() + 3 * DAY), progressPct: 1 }),
  );
  assert.equal(p, null, 'three days in is not enough to extrapolate from');
});

test('projectCompletion: refuses to guess with zero recorded progress', () => {
  assert.equal(projectCompletion(baseInput({ progressPct: 0 })), null);
});

test('a healthy project reports on-track and nothing else', () => {
  const out = buildInsights(baseInput());
  assert.deepEqual(ids(out), ['schedule.onTrack']);
  assert.equal(out[0].severity, 'GOOD');
});

test('slipping schedule is reported with the projected number of days', () => {
  const out = buildInsights(baseInput({ progressPct: 25 }));
  const slip = out.find((i) => i.id === 'schedule.slipping');
  assert.ok(slip);
  assert.match(slip.message, /projected to finish 120 days late/);
  assert.equal(slip.severity, 'CRITICAL');
});

test('spend running ahead of progress fires only past the tolerance', () => {
  const within = buildInsights(baseInput({ budget: { totalBudget: 100, totalActual: 58, consumedPct: 58 } }));
  assert.ok(!ids(within).includes('budget.spendAheadOfProgress'), '8% ahead is inside tolerance');

  const beyond = buildInsights(baseInput({ budget: { totalBudget: 100, totalActual: 70, consumedPct: 70 } }));
  assert.ok(ids(beyond).includes('budget.spendAheadOfProgress'));
});

test('an exhausted budget is critical, not a warning', () => {
  const out = buildInsights(baseInput({ budget: { totalBudget: 100, totalActual: 105, consumedPct: 105 } }));
  const b = out.find((i) => i.id === 'budget.spendAheadOfProgress');
  assert.ok(b);
  assert.equal(b.severity, 'CRITICAL');
});

test('results are ordered worst first', () => {
  const out = buildInsights(
    baseInput({
      status: 'ACTIVE',
      supervisorAssigned: false, // CRITICAL
      equipment: { down: 1, serviceOverdue: 1 }, // WARNING + INFO
    }),
  );
  const order = out.map((i) => i.severity);
  const rank = { CRITICAL: 0, WARNING: 1, INFO: 2, GOOD: 3 } as const;
  for (let i = 1; i < order.length; i++) {
    assert.ok(rank[order[i - 1]] <= rank[order[i]], `out of order at ${i}: ${order.join(',')}`);
  }
  assert.equal(out[0].id, 'staffing.noSupervisor');
});

test('financial insights are dropped entirely, not blanked, for supervisors', () => {
  const input = baseInput({
    budget: { totalBudget: 100, totalActual: 105, consumedPct: 105 },
    invoices: { outstanding: 500, overdue: 500, overdueCount: 2, oldestOverdueDays: 45 },
  });
  const withMoney = buildInsights(input, { includeFinancial: true });
  assert.ok(ids(withMoney).includes('budget.spendAheadOfProgress'));
  assert.ok(ids(withMoney).includes('invoices.overdue'));

  const withoutMoney = buildInsights(input, { includeFinancial: false });
  assert.ok(!ids(withoutMoney).includes('budget.spendAheadOfProgress'));
  assert.ok(!ids(withoutMoney).includes('invoices.overdue'));
  // Non-financial findings still come through.
  assert.ok(withoutMoney.length > 0);
  assert.ok(withoutMoney.every((i) => !i.financial));
});

test('attendance shortfall ignores a site with no roster', () => {
  const noRoster = buildInsights(baseInput({ attendance: { assigned: 0, present: 0 } }));
  assert.ok(!ids(noRoster).includes('attendance.shortfall'));
});

test('attendance shortfall fires once a quarter of the crew is missing', () => {
  const out = buildInsights(baseInput({ attendance: { assigned: 10, present: 7 } }));
  const a = out.find((i) => i.id === 'attendance.shortfall');
  assert.ok(a);
  assert.match(a.message, /3 assigned workers of 10/);
});

test('reporting rules only apply to active sites', () => {
  const onHold = buildInsights(baseInput({ status: 'ON_HOLD', daysSinceLastReport: 40 }));
  assert.ok(!ids(onHold).includes('reporting.quiet'));
  assert.ok(!ids(onHold).includes('staffing.noSupervisor'));
});

test('a site that has never reported is called out separately from a quiet one', () => {
  const never = buildInsights(baseInput({ daysSinceLastReport: null }));
  assert.ok(ids(never).includes('reporting.never'));

  const quiet = buildInsights(baseInput({ daysSinceLastReport: 10 }));
  assert.ok(ids(quiet).includes('reporting.quiet'));
});

test('rework is only worth mentioning once it repeats', () => {
  assert.ok(!ids(buildInsights(baseInput({ snags: { open: 1, overdue: 0, highOpen: 0, rework: 1 } }))).includes('snags.rework'));
  assert.ok(ids(buildInsights(baseInput({ snags: { open: 1, overdue: 0, highOpen: 0, rework: 3 } }))).includes('snags.rework'));
});

test('a serious safety incident outranks everything else', () => {
  const out = buildInsights(baseInput({ safety: { seriousLast30d: 1, totalLast30d: 4 } }));
  assert.equal(out[0].id, 'safety.serious');
  assert.equal(out[0].severity, 'CRITICAL');
});
