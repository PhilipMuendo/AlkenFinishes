import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertPaymentAllowed,
  effectiveDueDate,
  isPayable,
  payablePosition,
  payablesSummary,
  paymentSettles,
  PayableError,
  splitVat,
  supplierPositions,
  withholdingOn,
  type PayableCost,
  type PayablePayment,
} from './payables';

// Local midnight, not UTC: ageing is struck against startOfDay() in the
// server's own timezone, so a UTC fixture would drift a day either side of it
// depending on where the test happens to run.
const d = (iso: string) => {
  const [y, m, day] = iso.split('-').map(Number);
  return new Date(y, m - 1, day);
};
const NOW = d('2026-08-09');

const bill = (
  id: string,
  amount: number,
  opts: Partial<PayableCost> = {},
): PayableCost => ({
  id,
  supplierId: 'bamburi',
  amount,
  dueDate: d('2026-08-01'),
  expenseDate: d('2026-07-15'),
  ...opts,
});

const pay = (amount: number, tax: Partial<PayablePayment> = {}): PayablePayment => ({
  amount,
  ...tax,
});

test('a cost with no supplier is not on the ledger at all', () => {
  // Fuel, petty cash, wages handed out on site: the money is already gone.
  assert.equal(isPayable({ supplierId: null }), false);
  assert.equal(isPayable({ supplierId: 'bamburi' }), true);
});

test('an unpaid bill is outstanding in full', () => {
  const p = payablePosition(bill('a', 500_000), [], NOW);
  assert.equal(p.paid, 0);
  assert.equal(p.outstanding, 500_000);
  assert.equal(p.paidPct, 0);
  assert.equal(p.settled, false);
});

test('part-payments accumulate and the balance is what is left', () => {
  const p = payablePosition(bill('a', 500_000), [pay(200_000), pay(150_000)], NOW);
  assert.equal(p.paid, 350_000);
  assert.equal(p.outstanding, 150_000);
  assert.equal(p.paidPct, 70);
  assert.equal(p.settled, false);
});

test('paying the balance settles the bill exactly', () => {
  const p = payablePosition(bill('a', 500_000), [pay(200_000), pay(150_000), pay(150_000)], NOW);
  assert.equal(p.outstanding, 0);
  assert.equal(p.settled, true);
  assert.equal(p.overdue, false, 'a settled bill is never chased, however old it is');
  assert.equal(p.daysOverdue, 0);
});

test('an overpayment is reported, not netted into a negative balance', () => {
  // Quietly carrying -20,000 forward would understate the next bill.
  const p = payablePosition(bill('a', 500_000), [pay(520_000)], NOW);
  assert.equal(p.outstanding, 0);
  assert.equal(p.overpaid, 20_000);
  assert.equal(p.settled, true);
});

test('an unpaid bill past its due date is overdue and aged', () => {
  const p = payablePosition(bill('a', 500_000, { dueDate: d('2026-07-10') }), [pay(100_000)], NOW);
  assert.equal(p.outstanding, 400_000);
  assert.equal(p.overdue, true);
  assert.equal(p.daysOverdue, 30);
  assert.equal(p.agingBucket, 'D1_30');
});

test('no payment terms means due on the day of purchase, not never', () => {
  const cost = bill('a', 100_000, { dueDate: null, expenseDate: d('2026-06-01') });
  assert.equal(effectiveDueDate(cost).getTime(), d('2026-06-01').getTime());
  const p = payablePosition(cost, [], NOW);
  assert.equal(p.overdue, true, 'cash on delivery that was never paid is a debt, not current');
  assert.equal(p.agingBucket, 'D61_90');
});

test('a bill worth nothing does not divide by zero', () => {
  const p = payablePosition(bill('z', 0), [], NOW);
  assert.equal(p.paidPct, 100);
  assert.equal(p.settled, true);
  assert.equal(p.outstanding, 0);
});

test('rounding cannot leak value across a run of part-payments', () => {
  // A bill that does not divide cleanly into thirds.
  const cost = bill('x', 1_000.01);
  const p = payablePosition(cost, [pay(333.34), pay(333.34), pay(333.33)], NOW);
  assert.equal(p.paid, 1_000.01);
  assert.equal(p.outstanding, 0, 'three part-payments must settle the bill exactly');
});

test('positions roll up per supplier, and costs without one are skipped', () => {
  const costs = [
    bill('a', 500_000), // 300,000 paid below, so 200,000 owed
    bill('b', 400_000, { supplierId: 'simba' }), // nothing paid, so 400,000 owed
    bill('c', 90_000, { supplierId: null }), // petty cash — not a debt
  ];
  const payments = new Map([['a', [pay(300_000)]]]);
  const positions = supplierPositions(costs, payments, NOW);

  assert.equal(positions.length, 2, 'the supplier-less cost creates no phantom row');
  // Biggest debt first — that is the one that stops a delivery tomorrow. Note
  // this is by what is OWED, not by what was billed: bamburi billed more.
  assert.deepEqual(
    positions.map((p) => p.supplierId),
    ['simba', 'bamburi'],
  );
  const bamburi = positions.find((p) => p.supplierId === 'bamburi')!;
  assert.equal(bamburi.billed, 500_000);
  assert.equal(bamburi.paid, 300_000);
  assert.equal(bamburi.outstanding, 200_000);
  assert.equal(bamburi.openBills, 1);
});

test('a settled bill stops counting as an open bill but still counts as billed', () => {
  const costs = [bill('a', 500_000), bill('b', 100_000)];
  const payments = new Map([
    ['a', [pay(500_000)]],
    ['b', [pay(40_000)]],
  ]);
  const [pos] = supplierPositions(costs, payments, NOW);
  assert.equal(pos.billed, 600_000);
  assert.equal(pos.paid, 540_000);
  assert.equal(pos.outstanding, 60_000);
  assert.equal(pos.openBills, 1, 'only the part-paid bill is still open');
});

test('only money still owed is aged', () => {
  const costs = [
    bill('a', 500_000, { dueDate: d('2026-01-01') }), // ancient but settled
    bill('b', 100_000, { dueDate: d('2026-08-05') }),
  ];
  const payments = new Map([['a', [pay(500_000)]]]);
  const [pos] = supplierPositions(costs, payments, NOW);
  assert.equal(pos.aging.D90_PLUS, 0, 'a paid bill is not chased');
  assert.equal(pos.aging.D1_30, 100_000);
  assert.equal(pos.oldestOverdueDays, 4);
});

test('the company summary adds the suppliers up without double counting', () => {
  const costs = [
    bill('a', 500_000),
    bill('b', 200_000, { supplierId: 'simba' }),
    bill('c', 300_000, { supplierId: 'tiles-ltd' }),
  ];
  const payments = new Map([
    ['a', [pay(500_000)]], // fully settled
    ['b', [pay(50_000)]],
  ]);
  const s = payablesSummary(supplierPositions(costs, payments, NOW));

  assert.equal(s.billed, 1_000_000);
  assert.equal(s.paid, 550_000);
  assert.equal(s.outstanding, 450_000);
  assert.equal(s.supplierCount, 2, 'the fully-paid supplier is not someone to pay');
  assert.equal(s.openBills, 2);
  assert.equal(s.aging.D1_30 + s.aging.CURRENT, 450_000);
});

test('a payment against a cost with no supplier is refused, not silently booked', () => {
  assert.throws(
    () => assertPaymentAllowed(bill('a', 100_000, { supplierId: null }), [], pay(10_000)),
    (e: unknown) => e instanceof PayableError && /no supplier/.test((e as Error).message),
  );
});

test('a payment beyond the balance is refused by amount unless allowed explicitly', () => {
  const cost = bill('a', 500_000);
  const existing = [pay(400_000)];
  assert.throws(
    () => assertPaymentAllowed(cost, existing, pay(150_000)),
    (e: unknown) =>
      e instanceof PayableError && /100000/.test((e as Error).message.replace(/\D/g, '')),
  );
  // The office can still force it through when the bank statement says so.
  assert.doesNotThrow(() =>
    assertPaymentAllowed(cost, existing, pay(150_000), { allowOverpayment: true }),
  );
});

test('paying a bill that is already settled is refused', () => {
  assert.throws(
    () => assertPaymentAllowed(bill('a', 100_000), [pay(100_000)], pay(1)),
    (e: unknown) => e instanceof PayableError && /already paid/.test((e as Error).message),
  );
});

test('a zero or negative payment is refused', () => {
  assert.throws(() => assertPaymentAllowed(bill('a', 100_000), [], pay(0)), PayableError);
  assert.throws(() => assertPaymentAllowed(bill('a', 100_000), [], pay(-5_000)), PayableError);
  assert.throws(() => assertPaymentAllowed(bill('a', 100_000), [], pay(NaN)), PayableError);
});

test('paying exactly the outstanding balance is allowed', () => {
  assert.doesNotThrow(() =>
    assertPaymentAllowed(bill('a', 500_000), [pay(400_000)], pay(100_000)),
  );
});

// ---- Tax ----

test('withheld tax settles the bill exactly as cash does', () => {
  // 500,000 bill, 3% withholding: the supplier is paid in full on 485,000.
  const p = payablePosition(bill('a', 500_000), [pay(485_000, { whtAmount: 15_000 })], NOW);
  assert.equal(p.cashPaid, 485_000);
  assert.equal(p.taxWithheld, 15_000);
  assert.equal(p.paid, 500_000);
  assert.equal(p.outstanding, 0, 'the supplier is owed nothing further');
  assert.equal(p.settled, true);
});

test('counting only the cash would leave a settled bill looking short', () => {
  // Guards the bug this column exists to prevent: without withholding the
  // bill sits 15,000 open for ever and gets paid a second time.
  const payments = [pay(485_000, { whtAmount: 15_000 })];
  assert.equal(paymentSettles(payments[0]), 500_000);
  assert.notEqual(payments[0].amount, paymentSettles(payments[0]));
});

test('withholding VAT and withholding tax both settle, and both are owed to KRA', () => {
  const p = payablePosition(
    bill('a', 500_000),
    [pay(475_000, { whtAmount: 15_000, whtVatAmount: 10_000 })],
    NOW,
  );
  assert.equal(p.taxWithheld, 25_000);
  assert.equal(p.paid, 500_000);
  assert.equal(p.settled, true);
});

test('a payment that settles the bill via withholding is not refused as an overpayment', () => {
  const cost = bill('a', 500_000);
  assert.doesNotThrow(() =>
    assertPaymentAllowed(cost, [], pay(485_000, { whtAmount: 15_000 })),
    'cash plus tax equals the bill exactly, so this must be allowed',
  );
  // But cash plus tax beyond the bill is still an overpayment.
  assert.throws(
    () => assertPaymentAllowed(cost, [], pay(500_000, { whtAmount: 15_000 })),
    PayableError,
  );
});

test('input VAT is only reclaimable against a tax invoice', () => {
  const withEtr = payablePosition(
    bill('a', 580_000, { vatAmount: 80_000, taxInvoice: true }),
    [],
    NOW,
  );
  assert.equal(withEtr.netAmount, 500_000);
  assert.equal(withEtr.reclaimableVat, 80_000);

  // Same money, no tax invoice: the VAT is simply part of what the job cost.
  const noEtr = payablePosition(
    bill('b', 580_000, { vatAmount: 80_000, taxInvoice: false }),
    [],
    NOW,
  );
  assert.equal(noEtr.vatAmount, 80_000);
  assert.equal(noEtr.reclaimableVat, 0);
  assert.equal(noEtr.outstanding, 580_000, 'we still owe the supplier the gross either way');
});

test('a VAT-inclusive figure splits back to exactly what the supplier printed', () => {
  const s = splitVat(580_000, 16, true);
  assert.equal(s.gross, 580_000);
  assert.equal(s.net, 500_000);
  assert.equal(s.vat, 80_000);
  assert.equal(s.net + s.vat, s.gross, 'net and VAT must add back to the printed figure');
});

test('a VAT-exclusive figure grosses up instead of being carved into', () => {
  const s = splitVat(500_000, 16, false);
  assert.equal(s.net, 500_000);
  assert.equal(s.vat, 80_000);
  assert.equal(s.gross, 580_000);
});

test('an awkward VAT-inclusive figure still reconciles to the penny', () => {
  const s = splitVat(1_000.01, 16, true);
  assert.equal(s.net + s.vat, s.gross, 'the remainder method cannot lose a cent');
});

test('zero-rated and exempt supplies carry no VAT', () => {
  const s = splitVat(500_000, 0, true);
  assert.equal(s.vat, 0);
  assert.equal(s.net, 500_000);
  assert.equal(s.gross, 500_000);
});

test('withholding is computed on the ex-VAT value, never on the gross', () => {
  // 3% of 500,000 net = 15,000. Applying 3% to the 580,000 gross would take
  // 17,400 — 2,400 of the supplier's money that KRA never asked for.
  assert.equal(withholdingOn(500_000, 3), 15_000);
  assert.notEqual(withholdingOn(580_000, 3), 15_000);
  assert.equal(withholdingOn(500_000, 0), 0);
});

test('supplier rollups carry the tax figures, not just the cash', () => {
  const costs = [bill('a', 580_000, { vatAmount: 80_000, taxInvoice: true })];
  const payments = new Map([['a', [pay(485_000, { whtAmount: 15_000 })]]]);
  const [pos] = supplierPositions(costs, payments, NOW);
  assert.equal(pos.cashPaid, 485_000);
  assert.equal(pos.taxWithheld, 15_000);
  assert.equal(pos.reclaimableVat, 80_000);
  assert.equal(pos.outstanding, 80_000);

  const s = payablesSummary([pos]);
  assert.equal(s.taxWithheld, 15_000, 'this is money owed to KRA, and must be visible');
  assert.equal(s.reclaimableVat, 80_000);
  assert.equal(s.cashPaid, 485_000);
});
