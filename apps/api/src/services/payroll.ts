import { prisma } from '../lib/prisma';
import { kes, sumCents, toCents } from './money';

/**
 * Statutory deductions on wages.
 *
 * IMPORTANT: nothing in this file asserts what the law requires. Every band,
 * rate, ceiling and relief is configuration the user owns and can edit,
 * because they are changed by finance act and by the nature of the
 * engagement. What this file guarantees is that whatever rates are set are
 * applied consistently, in integer cents, in the right ORDER — which is where
 * payroll arithmetic actually goes wrong:
 *
 *   1. Gross pay.
 *   2. Pension-type deductions (NSSF) come off first, because they are
 *      allowable against tax. Deducting them after PAYE overstates the tax.
 *   3. PAYE is charged on the taxable pay that remains, through the bands,
 *      and personal relief is then subtracted from the TAX — never from pay.
 *      Relief is a flat credit worth its whole value; deducting it from pay
 *      instead is worth only its value at the marginal rate, which overcharges
 *      the worker.
 *   4. SHIF and the housing levy are charged on GROSS, not on what is left,
 *      so their base is untouched by steps 2 and 3.
 *
 * Employer contributions are computed separately and never deducted from the
 * worker: they are a cost to the company on top of the wage, and folding them
 * into the deduction column would silently cut somebody's pay.
 */

export interface PayeBand {
  /** Upper bound of this band in KES per period. Null means "and above". */
  upTo: number | null;
  ratePct: number;
}

export interface NssfTier {
  /** Upper bound of pensionable pay this tier covers. Null means "and above". */
  upTo: number | null;
  employeePct: number;
  employerPct: number;
}

export interface PayrollConfig {
  /** Whether statutory deductions are applied at all. Off until switched on. */
  enabled: boolean;
  payeBands: PayeBand[];
  /** Subtracted from the TAX due, not from pay. */
  personalReliefPerMonth: number;
  nssfTiers: NssfTier[];
  shifRatePct: number;
  /** Some schemes set a floor on the health contribution. Zero disables it. */
  shifMinimum: number;
  housingLevyEmployeePct: number;
  housingLevyEmployerPct: number;
}

/**
 * Defaults reflect the Kenyan structure at the time of writing. They are a
 * STARTING POINT the user is expected to check and edit in Settings, not a
 * statement of what is currently due.
 */
export const DEFAULT_PAYROLL_CONFIG: PayrollConfig = {
  enabled: false,
  payeBands: [
    { upTo: 24_000, ratePct: 10 },
    { upTo: 32_333, ratePct: 25 },
    { upTo: 500_000, ratePct: 30 },
    { upTo: 800_000, ratePct: 32.5 },
    { upTo: null, ratePct: 35 },
  ],
  personalReliefPerMonth: 2_400,
  nssfTiers: [
    { upTo: 8_000, employeePct: 6, employerPct: 6 },
    { upTo: 72_000, employeePct: 6, employerPct: 6 },
  ],
  shifRatePct: 2.75,
  shifMinimum: 300,
  housingLevyEmployeePct: 1.5,
  housingLevyEmployerPct: 1.5,
};

export async function getPayrollConfig(): Promise<PayrollConfig> {
  const row = await prisma.setting.findUnique({ where: { key: 'payroll' } });
  const v = (row?.value ?? {}) as Partial<PayrollConfig>;
  return {
    ...DEFAULT_PAYROLL_CONFIG,
    ...v,
    // Arrays must be replaced wholesale, never merged: a spread would leave
    // stale bands behind a shorter edited list.
    payeBands: Array.isArray(v.payeBands) && v.payeBands.length
      ? v.payeBands
      : DEFAULT_PAYROLL_CONFIG.payeBands,
    nssfTiers: Array.isArray(v.nssfTiers) ? v.nssfTiers : DEFAULT_PAYROLL_CONFIG.nssfTiers,
  };
}

// ---- The computation ----

/**
 * Progressive tax through the bands.
 *
 * Each band's rate applies only to the slice of pay inside it — the whole of
 * pay is never charged at the top rate reached. Bands must be in ascending
 * order; a band whose bound is below the previous one contributes nothing
 * rather than a negative charge.
 */
export function payeOnCents(taxablePayCents: number, bands: PayeBand[]): number {
  if (taxablePayCents <= 0) return 0;
  let tax = 0;
  let floor = 0;
  for (const band of bands) {
    const ceiling = band.upTo === null ? Infinity : toCents(band.upTo);
    if (taxablePayCents <= floor) break;
    const slice = Math.min(taxablePayCents, ceiling) - floor;
    if (slice > 0) tax += Math.round((slice * band.ratePct) / 100);
    if (ceiling === Infinity) break;
    floor = Math.max(floor, ceiling);
  }
  return tax;
}

export interface NssfResult {
  employee: number;
  employer: number;
}

/** Tiered contribution on pensionable pay, capped by the last tier's bound. */
export function nssfOnCents(grossCents: number, tiers: NssfTier[]): NssfResult {
  let employee = 0;
  let employer = 0;
  let floor = 0;
  for (const tier of tiers) {
    const ceiling = tier.upTo === null ? Infinity : toCents(tier.upTo);
    if (grossCents <= floor) break;
    const slice = Math.min(grossCents, ceiling) - floor;
    if (slice > 0) {
      employee += Math.round((slice * tier.employeePct) / 100);
      employer += Math.round((slice * tier.employerPct) / 100);
    }
    if (ceiling === Infinity) break;
    floor = Math.max(floor, ceiling);
  }
  return { employee, employer };
}

export interface PayslipInput {
  /** Wage earned in the period, before any deduction. */
  gross: number;
}

export interface Payslip {
  gross: number;
  /** NSSF employee share. Allowable against tax, so taken before PAYE. */
  nssf: number;
  /** gross − nssf: what PAYE is actually charged on. */
  taxablePay: number;
  /** Tax through the bands, before relief. */
  payeBeforeRelief: number;
  personalRelief: number;
  /** payeBeforeRelief − relief, floored at zero. Relief is not a refund. */
  paye: number;
  shif: number;
  housingLevy: number;
  /** Everything withheld from the worker. */
  totalDeductions: number;
  /** What the worker actually receives. */
  netPay: number;
  employerNssf: number;
  employerHousingLevy: number;
  /** gross + employer contributions: what the job actually costs. */
  employerCost: number;
}

/**
 * One payslip.
 *
 * With `enabled: false` this returns the wage untouched — every figure zero,
 * net equal to gross — so a company that pays casuals cash and files nothing
 * sees exactly what it sees today.
 */
export function computePayslip(input: PayslipInput, config: PayrollConfig): Payslip {
  const grossCents = toCents(input.gross);

  if (!config.enabled) {
    return {
      gross: kes(grossCents),
      nssf: 0,
      taxablePay: kes(grossCents),
      payeBeforeRelief: 0,
      personalRelief: 0,
      paye: 0,
      shif: 0,
      housingLevy: 0,
      totalDeductions: 0,
      netPay: kes(grossCents),
      employerNssf: 0,
      employerHousingLevy: 0,
      employerCost: kes(grossCents),
    };
  }

  // 1. NSSF first — allowable against tax. Charging PAYE before this
  //    overstates the tax on every worker who contributes.
  const nssf = nssfOnCents(grossCents, config.nssfTiers);
  const taxablePayCents = Math.max(0, grossCents - nssf.employee);

  // 2. PAYE through the bands, then relief off the TAX. Relief is a flat
  //    credit; taking it off pay instead is worth only its marginal-rate
  //    value and overcharges the worker.
  const payeBeforeRelief = payeOnCents(taxablePayCents, config.payeBands);
  const reliefCents = toCents(config.personalReliefPerMonth);
  const appliedRelief = Math.min(payeBeforeRelief, reliefCents);
  const paye = payeBeforeRelief - appliedRelief;

  // 3. SHIF and the levy sit on GROSS, so nothing above changes their base.
  const shifRaw = Math.round((grossCents * config.shifRatePct) / 100);
  const shif =
    grossCents > 0 ? Math.max(shifRaw, toCents(config.shifMinimum)) : 0;
  const housingLevy = Math.round((grossCents * config.housingLevyEmployeePct) / 100);
  const employerHousingLevy = Math.round(
    (grossCents * config.housingLevyEmployerPct) / 100,
  );

  const totalDeductions = nssf.employee + paye + shif + housingLevy;

  return {
    gross: kes(grossCents),
    nssf: kes(nssf.employee),
    taxablePay: kes(taxablePayCents),
    payeBeforeRelief: kes(payeBeforeRelief),
    personalRelief: kes(appliedRelief),
    paye: kes(paye),
    shif: kes(shif),
    housingLevy: kes(housingLevy),
    totalDeductions: kes(totalDeductions),
    // Can only go negative if rates are set past 100%, which is the user's
    // error to see rather than one to hide behind a clamp.
    netPay: kes(grossCents - totalDeductions),
    employerNssf: kes(nssf.employer),
    employerHousingLevy: kes(employerHousingLevy),
    employerCost: kes(grossCents + nssf.employer + employerHousingLevy),
  };
}

export interface PayrollTotals {
  gross: number;
  paye: number;
  nssfEmployee: number;
  nssfEmployer: number;
  shif: number;
  housingLevyEmployee: number;
  housingLevyEmployer: number;
  totalDeductions: number;
  netPay: number;
  employerCost: number;
  /** What has to be remitted: employee deductions plus employer shares. */
  remittances: { paye: number; nssf: number; shif: number; housingLevy: number };
}

/** Roll payslips up into what has to be paid, and to whom. */
export function payrollTotals(slips: Payslip[]): PayrollTotals {
  const sum = (pick: (s: Payslip) => number) => sumCents(slips.map((s) => toCents(pick(s))));

  const paye = sum((s) => s.paye);
  const nssfEmployee = sum((s) => s.nssf);
  const nssfEmployer = sum((s) => s.employerNssf);
  const shif = sum((s) => s.shif);
  const levyEmployee = sum((s) => s.housingLevy);
  const levyEmployer = sum((s) => s.employerHousingLevy);

  return {
    gross: kes(sum((s) => s.gross)),
    paye: kes(paye),
    nssfEmployee: kes(nssfEmployee),
    nssfEmployer: kes(nssfEmployer),
    shif: kes(shif),
    housingLevyEmployee: kes(levyEmployee),
    housingLevyEmployer: kes(levyEmployer),
    totalDeductions: kes(sum((s) => s.totalDeductions)),
    netPay: kes(sum((s) => s.netPay)),
    employerCost: kes(sum((s) => s.employerCost)),
    remittances: {
      paye: kes(paye),
      // Both halves go to the fund in one payment, so they are added here
      // rather than left for whoever writes the cheque to remember.
      nssf: kes(nssfEmployee + nssfEmployer),
      shif: kes(shif),
      housingLevy: kes(levyEmployee + levyEmployer),
    },
  };
}
