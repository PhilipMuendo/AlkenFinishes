import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allowanceFor,
  allowanceMessage,
  quotaDay,
  totalCalls,
  type AiBudget,
  type UsageRow,
} from './aiUsage';

const budget: AiBudget = { dailyCalls: 200, reservedForWork: 60 };

const usage = (over: Partial<UsageRow> = {}): UsageRow => ({
  day: '2026-08-10',
  chat: 0,
  receipt: 0,
  report: 0,
  ...over,
});

test('a quiet day lets everything through', () => {
  const u = usage();
  assert.equal(allowanceFor('chat', u, budget).allowed, true);
  assert.equal(allowanceFor('receipt', u, budget).allowed, true);
  assert.equal(allowanceFor('report', u, budget).allowed, true);
});

test('chat stops at the reserve while receipts carry on', () => {
  // 140 spent: chat's ceiling (200 - 60) is reached, but 60 calls remain.
  const u = usage({ chat: 140 });
  const chat = allowanceFor('chat', u, budget);
  assert.equal(chat.allowed, false);
  assert.equal(chat.reason, 'RESERVED_FOR_WORK');
  assert.equal(chat.remainingOverall, 60);

  assert.equal(allowanceFor('receipt', u, budget).allowed, true);
  assert.equal(allowanceFor('report', u, budget).allowed, true);
});

test('the reserve is measured against every feature, not just chat', () => {
  // Receipts alone can push chat over its ceiling — the cap is shared.
  const u = usage({ receipt: 145 });
  assert.equal(allowanceFor('chat', u, budget).allowed, false);
  assert.equal(allowanceFor('receipt', u, budget).allowed, true);
});

test('when the budget is truly spent everything stops, and says so', () => {
  const u = usage({ chat: 140, receipt: 60 });
  const receipt = allowanceFor('receipt', u, budget);
  assert.equal(receipt.allowed, false);
  assert.equal(receipt.reason, 'BUDGET_SPENT');

  const chat = allowanceFor('chat', u, budget);
  assert.equal(chat.reason, 'BUDGET_SPENT');
  // The two failures read differently, because the fix differs: one waits for
  // tomorrow, the other means the other features still work.
  assert.notEqual(allowanceMessage(chat), allowanceMessage({ ...chat, reason: 'RESERVED_FOR_WORK' }));
});

test('the yielding message says the other features still work', () => {
  const msg = allowanceMessage({
    allowed: false,
    remaining: 0,
    remainingOverall: 40,
    reason: 'RESERVED_FOR_WORK',
  });
  assert.match(msg, /receipts/i);
  assert.match(msg, /still work/i);
});

test('a zero reserve gives chat the whole budget', () => {
  const b: AiBudget = { dailyCalls: 10, reservedForWork: 0 };
  assert.equal(allowanceFor('chat', usage({ chat: 9 }), b).allowed, true);
  assert.equal(allowanceFor('chat', usage({ chat: 10 }), b).allowed, false);
});

test('a reserve larger than the budget stops chat entirely rather than going negative', () => {
  const b: AiBudget = { dailyCalls: 50, reservedForWork: 80 };
  const a = allowanceFor('chat', usage(), b);
  assert.equal(a.allowed, false);
  assert.equal(a.remaining, 0);
  assert.equal(a.reason, 'RESERVED_FOR_WORK');
});

test('totals count every feature', () => {
  assert.equal(totalCalls(usage({ chat: 3, receipt: 4, report: 5 })), 12);
});

test('the quota day follows the provider, not the office', () => {
  // Los Angeles runs behind UTC, so 03:00 UTC on the 10th is still the evening
  // of the 9th where the allowance actually resets. Rolling the counter at
  // Nairobi midnight — six hours earlier again — would free the budget while
  // the provider still considered it spent, and the "you have calls left"
  // message would be a lie.
  assert.equal(quotaDay(new Date('2026-08-10T03:00:00Z')), '2026-08-09');
  assert.equal(quotaDay(new Date('2026-08-10T09:00:00Z')), '2026-08-10');
  assert.equal(quotaDay(new Date('2026-08-10T20:00:00Z')), '2026-08-10');
});
