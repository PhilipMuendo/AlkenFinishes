import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computePayslip,
  DEFAULT_PAYROLL_CONFIG,
  nssfOnCents,
  payeOnCents,
  payrollTotals,
  type PayrollConfig,
} from './payroll';
import { toCents } from './money';

const ON: PayrollConfig = { ...DEFAULT_PAYROLL_CONFIG, enabled: true };

test('with deductions switched off the wage is untouched', () => {
  // A company paying casuals cash and filing nothing must see exactly what it
  // sees today, not a payslip full of zeros it has to reason about.
  const s = computePayslip({ gross: 30_000 }, DEFAULT_PAYROLL_CONFIG);
  assert.equal(s.netPay, 30_000);
  assert.equal(s.totalDeductions, 0);
  assert.equal(s.employerCost, 30_000, 'no employer contribution either');
});

test('PAYE charges each band only on the slice inside it', () => {
  // 30,000 taxable: 24,000 at 10% = 2,400, then 6,000 at 25% = 1,500.
  const bands = ON.payeBands;
  assert.equal(payeOnCents(toCents(30_000), bands), toCents(3_900));
});

test('the whole of pay is never charged at the top rate reached', () => {
  const flatTopRate = Math.round(toCents(30_000) * 0.25);
  assert.notEqual(payeOnCents(toCents(30_000), ON.payeBands), flatTopRate);
  assert.ok(payeOnCents(toCents(30_000), ON.payeBands) < flatTopRate);
});

test('pay inside the first band is charged at the first rate only', () => {
  assert.equal(payeOnCents(toCents(20_000), ON.payeBands), toCents(2_000));
});

test('no pay means no tax', () => {
  assert.equal(payeOnCents(0, ON.payeBands), 0);
  assert.equal(payeOnCents(-500, ON.payeBands), 0);
});

test('NSSF is tiered and stops at the last tier ceiling', () => {
  // 6% of 72,000 = 4,320 for each side, and nothing above that bound.
  const atCeiling = nssfOnCents(toCents(72_000), ON.nssfTiers);
  const wellAbove = nssfOnCents(toCents(500_000), ON.nssfTiers);
  assert.equal(atCeiling.employee, toCents(4_320));
  assert.equal(wellAbove.employee, atCeiling.employee, 'the cap holds');
  assert.equal(wellAbove.employer, atCeiling.employer);
});

test('NSSF comes off before PAYE, because it is allowable against tax', () => {
  const s = computePayslip({ gross: 50_000 }, ON);
  assert.equal(s.nssf, 3_000, '6% of 50,000');
  assert.equal(s.taxablePay, 47_000, 'tax is charged on gross less NSSF');

  // The bug this guards: charging PAYE on the full gross overstates the tax.
  const wrong = payeOnCents(toCents(50_000), ON.payeBands);
  const right = payeOnCents(toCents(47_000), ON.payeBands);
  assert.ok(right < wrong, 'ignoring NSSF would take more tax than is due');
  assert.equal(s.payeBeforeRelief, right / 100);
});

test('personal relief comes off the TAX, not off pay', () => {
  const s = computePayslip({ gross: 50_000 }, ON);
  assert.equal(s.paye, s.payeBeforeRelief - s.personalRelief);

  // Relief is a flat credit against the tax, so it is worth its whole value.
  // Deducting it from PAY instead is only worth its value at the marginal
  // rate — 2,400 off pay at 30% saves 720, not 2,400 — so the worker is
  // overcharged. That is the error this ordering prevents.
  const reliefOffPay = payeOnCents(toCents(47_000 - 2_400), ON.payeBands) / 100;
  assert.notEqual(s.paye, reliefOffPay);
  assert.ok(
    s.paye < reliefOffPay,
    'taking relief off pay would charge the worker more tax than is due',
  );
  assert.equal(
    Math.round((reliefOffPay - s.paye) * 100) / 100,
    Math.round((2_400 - 2_400 * 0.3) * 100) / 100,
    'the gap is exactly the relief not credited in full',
  );
});

test('relief cannot turn into a refund on a small wage', () => {
  // Tax due below the relief: the charge is nil, never negative.
  const s = computePayslip({ gross: 12_000 }, ON);
  assert.equal(s.paye, 0);
  assert.ok(s.personalRelief <= s.payeBeforeRelief, 'only as much relief as there is tax');
});

test('SHIF and the housing levy sit on gross, not on what is left', () => {
  const s = computePayslip({ gross: 100_000 }, ON);
  assert.equal(s.shif, 2_750, '2.75% of the gross 100,000');
  assert.equal(s.housingLevy, 1_500, '1.5% of the gross 100,000');
  // Not of taxable pay, which is lower.
  assert.notEqual(s.shif, Math.round(s.taxablePay * 0.0275 * 100) / 100);
});

test('the health contribution respects its floor on a small wage', () => {
  const s = computePayslip({ gross: 5_000 }, ON);
  assert.equal(s.shif, 300, '2.75% would be 137.50, below the 300 floor');
});

test('a nil wage produces a nil payslip, with no minimum charged', () => {
  const s = computePayslip({ gross: 0 }, ON);
  assert.equal(s.shif, 0, 'a floor must not charge somebody who earned nothing');
  assert.equal(s.netPay, 0);
  assert.equal(s.totalDeductions, 0);
});

test('deductions and net add back to gross exactly', () => {
  for (const gross of [8_000, 23_999, 50_000, 137_777.77, 900_000]) {
    const s = computePayslip({ gross }, ON);
    assert.equal(
      Math.round((s.netPay + s.totalDeductions) * 100) / 100,
      gross,
      `net plus deductions must equal gross for ${gross}`,
    );
  }
});

test('every deduction line adds up to the total withheld', () => {
  const s = computePayslip({ gross: 60_000 }, ON);
  assert.equal(
    Math.round((s.paye + s.nssf + s.shif + s.housingLevy) * 100) / 100,
    s.totalDeductions,
  );
});

test('employer contributions are a cost on top, never taken from the worker', () => {
  const s = computePayslip({ gross: 50_000 }, ON);
  assert.ok(s.employerNssf > 0);
  assert.ok(s.employerHousingLevy > 0);
  assert.equal(
    Math.round((s.gross + s.employerNssf + s.employerHousingLevy) * 100) / 100,
    s.employerCost,
  );
  // The employer share must not appear in what the worker loses.
  assert.equal(
    Math.round((s.paye + s.nssf + s.shif + s.housingLevy) * 100) / 100,
    s.totalDeductions,
  );
  assert.ok(s.employerCost > s.gross, 'the job costs more than the wage');
});

test('a run totals what has to be remitted, and to whom', () => {
  const slips = [
    computePayslip({ gross: 50_000 }, ON),
    computePayslip({ gross: 30_000 }, ON),
  ];
  const t = payrollTotals(slips);

  assert.equal(t.gross, 80_000);
  assert.equal(
    Math.round((t.netPay + t.totalDeductions) * 100) / 100,
    t.gross,
    'the run reconciles as a whole, not just per payslip',
  );
  // Both halves of a fund go over in one payment.
  assert.equal(
    t.remittances.nssf,
    Math.round((t.nssfEmployee + t.nssfEmployer) * 100) / 100,
  );
  assert.equal(
    t.remittances.housingLevy,
    Math.round((t.housingLevyEmployee + t.housingLevyEmployer) * 100) / 100,
  );
  assert.equal(t.remittances.paye, t.paye);
});

test('rates are configuration: editing a band changes the tax', () => {
  const flat: PayrollConfig = {
    ...ON,
    payeBands: [{ upTo: null, ratePct: 5 }],
    personalReliefPerMonth: 0,
    nssfTiers: [],
    shifRatePct: 0,
    shifMinimum: 0,
    housingLevyEmployeePct: 0,
    housingLevyEmployerPct: 0,
  };
  const s = computePayslip({ gross: 100_000 }, flat);
  assert.equal(s.paye, 5_000);
  assert.equal(s.totalDeductions, 5_000, 'nothing else is charged when the rates are zero');
  assert.equal(s.netPay, 95_000);
});
