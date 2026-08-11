import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertWorkerPaymentAllowed,
  paymentSettlesWorker,
  WorkerPayError,
  workerPayablesSummary,
  workerPosition,
  type WorkerPaymentRecord,
} from './workerPay';
import { withholdingOn } from './payables';

const pay = (amount: number, wht = 0): WorkerPaymentRecord => ({ amount, whtAmount: wht });

test('a worker with nothing accrued yet is fully settled by definition', () => {
  const p = workerPosition(0, []);
  assert.equal(p.outstanding, 0);
  assert.equal(p.settled, true);
  assert.equal(p.paidPct, 100);
});

test('nothing paid is owed in full', () => {
  const p = workerPosition(50_000, []);
  assert.equal(p.outstanding, 50_000);
  assert.equal(p.paidPct, 0);
  assert.equal(p.settled, false);
});

test('withheld tax settles the balance exactly as cash does', () => {
  // 3% of 50,000 withheld, 48,500 cash — the balance is cleared, not left
  // 1,500 short because only cash was counted.
  const p = workerPosition(50_000, [pay(48_500, 1_500)]);
  assert.equal(p.cashPaid, 48_500);
  assert.equal(p.taxWithheld, 1_500);
  assert.equal(p.paid, 50_000);
  assert.equal(p.outstanding, 0);
  assert.equal(p.settled, true);
});

test('part payments accumulate and the balance is what is left', () => {
  const p = workerPosition(50_000, [pay(20_000, 600), pay(15_000, 450)]);
  assert.equal(p.paid, 36_050);
  assert.equal(p.outstanding, 13_950);
  assert.equal(p.settled, false);
});

test('overpayment is reported, not netted into a negative balance', () => {
  const p = workerPosition(50_000, [pay(55_000)]);
  assert.equal(p.outstanding, 0);
  assert.equal(p.overpaid, 5_000);
});

test('withholding is struck on the balance, at the configured rate', () => {
  assert.equal(withholdingOn(50_000, 3), 1_500);
  assert.equal(withholdingOn(50_000, 0), 0);
});

test('a company-wide summary rolls up every worker owed something', () => {
  const positions = [workerPosition(50_000, []), workerPosition(20_000, [pay(20_000)])];
  const summary = workerPayablesSummary(positions);
  assert.equal(summary.outstanding, 50_000);
  // Only the worker still owed something counts — the settled one does not.
  assert.equal(summary.workerCount, 1);
});

test('cash plus withheld tax is what a payment settles', () => {
  assert.equal(paymentSettlesWorker(pay(48_500, 1_500)), 50_000);
  assert.equal(paymentSettlesWorker(pay(48_500)), 48_500);
});

test('a zero payment is refused', () => {
  assert.throws(() => assertWorkerPaymentAllowed(50_000, [], pay(0)), WorkerPayError);
});

test('a negative part is refused, cash or withheld', () => {
  assert.throws(() => assertWorkerPaymentAllowed(50_000, [], pay(-100)), WorkerPayError);
  assert.throws(() => assertWorkerPaymentAllowed(50_000, [], pay(1000, -100)), WorkerPayError);
});

test('a payment against a worker who is owed nothing is refused', () => {
  assert.throws(
    () => assertWorkerPaymentAllowed(50_000, [pay(50_000)], pay(1)),
    WorkerPayError,
  );
});

test('a payment larger than the balance is refused unless overpayment is accepted', () => {
  assert.throws(() => assertWorkerPaymentAllowed(50_000, [], pay(60_000)), WorkerPayError);
  assert.doesNotThrow(() =>
    assertWorkerPaymentAllowed(50_000, [], pay(60_000), { allowOverpayment: true }),
  );
});

test('a payment that exactly settles the balance, cash plus withheld, is allowed', () => {
  assert.doesNotThrow(() => assertWorkerPaymentAllowed(50_000, [], pay(48_500, 1_500)));
});
