import test from 'node:test';
import assert from 'node:assert/strict';
import { weightedProgress } from './progress';

const t = (completionPct: number, weight = 1) => ({ completionPct, weight });

test('no tasks is zero, not a division by zero', () => {
  const r = weightedProgress([]);
  assert.equal(r.pct, 0);
  assert.equal(r.taskCount, 0);
  assert.equal(r.weighted, false);
});

test('all-default weights reproduce the old plain mean exactly', () => {
  // The regression that matters: switching this on must not move anybody's
  // reported progress until they enter real weights.
  const tasks = [t(100), t(50), t(0), t(30)];
  const r = weightedProgress(tasks);
  assert.equal(r.pct, 45);
  assert.equal(r.pct, r.unweightedPct);
  assert.equal(r.weighted, false, 'equal weights are not a weighting');
});

test('equal but non-default weights are still not called weighted', () => {
  const r = weightedProgress([t(100, 7), t(0, 7)]);
  assert.equal(r.pct, 50);
  assert.equal(r.weighted, false);
});

test('the door stop no longer counts as much as the whole block', () => {
  // 3,000,000 of painting at 0%, one 5,000 door stop at 100%.
  const r = weightedProgress([t(0, 3_000_000), t(100, 5_000)]);
  assert.equal(r.unweightedPct, 50, 'the old mean called this half done');
  assert.equal(r.pct, 0, 'weighted by value it has barely started');
  assert.equal(r.weighted, true);
});

test('adding trivial tasks no longer dilutes real progress', () => {
  const real = [t(100, 1_000_000), t(0, 1_000_000)];
  const withNoise = [...real, t(0, 1_000), t(0, 1_000), t(0, 1_000)];
  assert.equal(weightedProgress(real).pct, 50);
  assert.equal(weightedProgress(withNoise).pct, 50, 'within rounding of the real figure');
  // The old behaviour, for contrast.
  assert.equal(weightedProgress(withNoise).unweightedPct, 20);
});

test('weights are relative, so the unit does not matter', () => {
  const inShillings = weightedProgress([t(100, 750_000), t(0, 250_000)]);
  const inDays = weightedProgress([t(100, 3), t(0, 1)]);
  assert.equal(inShillings.pct, 75);
  assert.equal(inDays.pct, inShillings.pct);
});

test('a zero or negative weight is dropped, not counted as weightless', () => {
  // A task at weight 0 must not drag the total toward zero.
  const r = weightedProgress([t(100, 10), t(0, 0), t(0, -5)]);
  assert.equal(r.pct, 100);
  assert.equal(r.totalWeight, 10);
});

test('all weights unusable falls back to the plain mean rather than reporting zero', () => {
  const r = weightedProgress([t(80, 0), t(20, 0)]);
  assert.equal(r.pct, 50);
  assert.equal(r.weighted, false);
});

test('completion is clamped, so bad data cannot push progress past 100', () => {
  const r = weightedProgress([
    { completionPct: 400, weight: 1 },
    { completionPct: -50, weight: 1 },
  ]);
  assert.equal(r.pct, 50);
});

test('a half-finished weighting job is reported, because it is misleading', () => {
  // Two tasks priced, one still on the default weight of 1 — effectively
  // invisible next to them, and the owner needs telling.
  const r = weightedProgress([t(0, 500_000), t(0, 300_000), t(100)]);
  assert.equal(r.weighted, true);
  assert.equal(r.unweightedTaskCount, 1);
  assert.equal(r.pct, 0, 'the unweighted task barely moves the figure');
});

test('an all-default project reports no unweighted tasks, since that is just noise', () => {
  const r = weightedProgress([t(10), t(90)]);
  assert.equal(r.unweightedTaskCount, 0);
});
