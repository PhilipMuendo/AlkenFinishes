import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildClaim,
  claimPositions,
  ClaimError,
  previouslyClaimedBySourceLine,
  type PriorClaim,
  type ScheduleLine,
} from './claims';

const item = (id: string, lineTotal: number, sortOrder = 0): ScheduleLine => ({
  id,
  description: `Item ${id}`,
  quantity: 1,
  unit: 'item',
  unitPrice: lineTotal,
  lineTotal,
  taxable: true,
  sortOrder,
});

const prior = (sourceLineId: string, lineTotal: number): PriorClaim => ({ sourceLineId, lineTotal });

// A two-item schedule worth 1,000,000 in total.
const SCHEDULE = [item('a', 750_000, 0), item('b', 250_000, 1)];

test('nothing claimed yet leaves the whole contract value outstanding', () => {
  const [a, b] = claimPositions(SCHEDULE, []);
  assert.equal(a.previouslyClaimed, 0);
  assert.equal(a.remaining, 750_000);
  assert.equal(b.remaining, 250_000);
});

test('previously claimed sums every prior claim on the same item', () => {
  const claimed = previouslyClaimedBySourceLine([prior('a', 100_000), prior('a', 50_000), prior('b', 25_000)]);
  assert.equal(claimed.get('a'), 150_000);
  assert.equal(claimed.get('b'), 25_000);
});

test('the first claim bills the full cumulative value', () => {
  const c = buildClaim(SCHEDULE, [], [{ sourceLineId: 'a', cumulativePct: 40 }]);
  assert.equal(c.lines.length, 1);
  assert.equal(c.lines[0].cumulativeValue, 300_000);
  assert.equal(c.lines[0].previouslyClaimed, 0);
  assert.equal(c.lines[0].lineTotal, 300_000);
  assert.equal(c.subtotal, 300_000);
});

test('the second claim bills only the difference', () => {
  // 40% claimed last month, 65% complete now: bill the 25% gap, not 65%.
  const priors = [prior('a', 300_000)];
  const c = buildClaim(SCHEDULE, priors, [{ sourceLineId: 'a', cumulativePct: 65 }]);
  assert.equal(c.lines[0].cumulativeValue, 487_500);
  assert.equal(c.lines[0].previouslyClaimed, 300_000);
  assert.equal(c.lines[0].lineTotal, 187_500);
});

test('claiming to 100% across every item bills exactly the contract sum, never more', () => {
  // Three claims in sequence; the totals must add up to the contract value.
  const first = buildClaim(SCHEDULE, [], [
    { sourceLineId: 'a', cumulativePct: 30 },
    { sourceLineId: 'b', cumulativePct: 10 },
  ]);
  const afterFirst = first.lines.map((l) => prior(l.sourceLineId, l.lineTotal));

  const second = buildClaim(SCHEDULE, afterFirst, [
    { sourceLineId: 'a', cumulativePct: 80 },
    { sourceLineId: 'b', cumulativePct: 55 },
  ]);
  const afterSecond = [...afterFirst, ...second.lines.map((l) => prior(l.sourceLineId, l.lineTotal))];

  const third = buildClaim(SCHEDULE, afterSecond, [
    { sourceLineId: 'a', cumulativePct: 100 },
    { sourceLineId: 'b', cumulativePct: 100 },
  ]);

  const billed = first.subtotal + second.subtotal + third.subtotal;
  assert.equal(billed, 1_000_000, 'three claims must sum to the contract sum exactly');
});

test('a repeat claim at an unchanged percentage bills nothing and shows no line', () => {
  const priors = [prior('a', 300_000)];
  const c = buildClaim(SCHEDULE, priors, [{ sourceLineId: 'a', cumulativePct: 40 }]);
  assert.equal(c.lines.length, 0, 'a zero line pads the claim without adding information');
  assert.equal(c.subtotal, 0);
});

test('a percentage revised downwards produces a credit, flagged as a reversal', () => {
  // Last month said 60%; on measurement it is really 45%.
  const priors = [prior('a', 450_000)]; // 60%
  const c = buildClaim(SCHEDULE, priors, [{ sourceLineId: 'a', cumulativePct: 45 }]);
  assert.equal(c.lines[0].lineTotal, -112_500);
  assert.equal(c.subtotal, -112_500);
  assert.equal(c.reversals.length, 1, 'a credit must be surfaced, not issued quietly');
});

test('an over-claim leaves zero remaining rather than negative headroom', () => {
  const positions = claimPositions(SCHEDULE, [prior('a', 800_000)]);
  assert.equal(positions[0].previouslyClaimed, 800_000);
  assert.equal(positions[0].remaining, 0);
});

test('percentages outside 0-100 are refused by name, not silently clamped', () => {
  assert.throws(
    () => buildClaim(SCHEDULE, [], [{ sourceLineId: 'a', cumulativePct: 120 }]),
    (e: unknown) => e instanceof ClaimError && /Item a/.test((e as Error).message),
  );
  assert.throws(() => buildClaim(SCHEDULE, [], [{ sourceLineId: 'a', cumulativePct: -5 }]), ClaimError);
  assert.throws(() => buildClaim(SCHEDULE, [], [{ sourceLineId: 'a', cumulativePct: NaN }]), ClaimError);
});

test('an item that is not on this contract is refused', () => {
  assert.throws(
    () => buildClaim(SCHEDULE, [], [{ sourceLineId: 'ghost', cumulativePct: 50 }]),
    ClaimError,
  );
});

test('rounding cannot leak value across a run of claims', () => {
  // A value that does not divide cleanly by thirds.
  const odd = [item('x', 1_000.01, 0)];
  let priors: PriorClaim[] = [];
  let billed = 0;
  for (const pctToDate of [33.33, 66.66, 100]) {
    const c = buildClaim(odd, priors, [{ sourceLineId: 'x', cumulativePct: pctToDate }]);
    billed += c.subtotal;
    priors = [...priors, ...c.lines.map((l) => prior(l.sourceLineId, l.lineTotal))];
  }
  assert.equal(billed, 1_000.01, 'cumulative statement absorbs its own rounding');
});

test('lines come back in schedule order regardless of input order', () => {
  const c = buildClaim(SCHEDULE, [], [
    { sourceLineId: 'b', cumulativePct: 50 },
    { sourceLineId: 'a', cumulativePct: 50 },
  ]);
  assert.deepEqual(c.lines.map((l) => l.sourceLineId), ['a', 'b']);
});

test('an item worth nothing does not divide by zero', () => {
  const free = [item('z', 0, 0)];
  const positions = claimPositions(free, []);
  assert.equal(positions[0].previouslyClaimedPct, 0);
  const c = buildClaim(free, [], [{ sourceLineId: 'z', cumulativePct: 100 }]);
  assert.equal(c.lines.length, 0);
});
