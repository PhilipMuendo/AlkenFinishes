import { kes, sumCents, toCents } from './money';
import { prisma } from '../lib/prisma';
import { withholdingOn } from './payables';

export { withholdingOn };

/**
 * Paying a casual or contracted worker, and what is withheld from them.
 *
 * This is for a fundi paid for hours worked rather than employed on PAYE
 * terms — Payroll (services/payroll.ts, PayrollLine) is the other path, and
 * the two must never both apply to the same wage: PAYE and withholding tax
 * are alternative treatments of the same income, not additive.
 *
 * The shape mirrors services/payables.ts on purpose. There the "cost" is a
 * supplier's bill; here it is what attendance says a worker has accrued
 * (AttendanceRecord.labourCost, summed) — a running total rather than one
 * dated bill, because wages accrue continuously rather than arriving as a
 * single invoice. "Paid" is cash plus whatever tax was withheld from it,
 * exactly as it is for a supplier: withholding settles the wage just as cash
 * does, and counting only the cash would leave the balance permanently short
 * by whatever was sent to KRA instead of the worker.
 */

export interface StaffTaxConfig {
  /** Whether this company withholds tax from staff at all. Off by default. */
  withholdingAgent: boolean;
  /** Default withholding rate on a worker payment. Zero unless set. */
  defaultWhtRatePct: number;
}

export const DEFAULT_STAFF_TAX: StaffTaxConfig = {
  withholdingAgent: false,
  defaultWhtRatePct: 0,
};

export async function getStaffTaxConfig(): Promise<StaffTaxConfig> {
  const row = await prisma.setting.findUnique({ where: { key: 'staffTax' } });
  return { ...DEFAULT_STAFF_TAX, ...((row?.value ?? {}) as Partial<StaffTaxConfig>) };
}

/** One payment. `amount` is cash the worker received; `whtAmount` went to KRA instead. */
export interface WorkerPaymentRecord {
  amount: number;
  whtAmount?: number;
}

export interface WorkerPosition {
  /** Total accrued from attendance so far. */
  accrued: number;
  cashPaid: number;
  /** Tax withheld from the worker and owed to KRA. */
  taxWithheld: number;
  /** cashPaid + taxWithheld: what has settled the accrued wage. */
  paid: number;
  /** accrued − paid. Never negative; see `overpaid`. */
  outstanding: number;
  /** Paid beyond what was accrued. Surfaced, not netted away. */
  overpaid: number;
  paidPct: number;
  settled: boolean;
}

/** Cash + withheld tax. What a payment actually takes off the balance owed. */
export function paymentSettlesWorker(p: WorkerPaymentRecord): number {
  return kes(toCents(p.amount) + toCents(p.whtAmount ?? 0));
}

export function workerPosition(accrued: number, payments: WorkerPaymentRecord[]): WorkerPosition {
  const accruedCents = toCents(accrued);
  const cashCents = sumCents(payments.map((p) => toCents(p.amount)));
  const withheldCents = sumCents(payments.map((p) => toCents(p.whtAmount ?? 0)));
  const paidCents = cashCents + withheldCents;
  const diff = accruedCents - paidCents;
  const outstandingCents = Math.max(0, diff);
  const overpaidCents = Math.max(0, -diff);

  return {
    accrued: kes(accruedCents),
    cashPaid: kes(cashCents),
    taxWithheld: kes(withheldCents),
    paid: kes(paidCents),
    outstanding: kes(outstandingCents),
    overpaid: kes(overpaidCents),
    // Nothing accrued yet is fully settled by definition, not 0% paid.
    paidPct: accruedCents > 0 ? Math.round((paidCents / accruedCents) * 1000) / 10 : 100,
    settled: outstandingCents === 0,
  };
}

export interface WorkerPayableSummary {
  accrued: number;
  paid: number;
  cashPaid: number;
  taxWithheld: number;
  outstanding: number;
  overpaid: number;
  /** Workers with anything still outstanding. */
  workerCount: number;
}

/** The company-wide position: one number for "what do we owe the workforce right now". */
export function workerPayablesSummary(
  positions: WorkerPosition[],
): WorkerPayableSummary {
  let accrued = 0;
  let paid = 0;
  let cashPaid = 0;
  let taxWithheld = 0;
  let outstanding = 0;
  let overpaid = 0;

  for (const p of positions) {
    accrued = kes(toCents(accrued) + toCents(p.accrued));
    paid = kes(toCents(paid) + toCents(p.paid));
    cashPaid = kes(toCents(cashPaid) + toCents(p.cashPaid));
    taxWithheld = kes(toCents(taxWithheld) + toCents(p.taxWithheld));
    outstanding = kes(toCents(outstanding) + toCents(p.outstanding));
    overpaid = kes(toCents(overpaid) + toCents(p.overpaid));
  }

  return {
    accrued,
    paid,
    cashPaid,
    taxWithheld,
    outstanding,
    overpaid,
    workerCount: positions.filter((p) => p.outstanding > 0).length,
  };
}

export class WorkerPayError extends Error {}

/**
 * Check a payment before it is recorded.
 *
 * The comparison is against cash PLUS withheld tax, because that is what
 * settles the balance — checking cash alone would reject a payment that
 * clears it exactly, purely because part of the money went to KRA rather
 * than the worker.
 */
export function assertWorkerPaymentAllowed(
  accrued: number,
  existing: WorkerPaymentRecord[],
  payment: WorkerPaymentRecord,
  opts: { allowOverpayment?: boolean } = {},
): void {
  const settles = paymentSettlesWorker(payment);
  if (!Number.isFinite(settles) || settles <= 0) {
    throw new WorkerPayError('A payment must be greater than zero');
  }
  if (payment.amount < 0 || (payment.whtAmount ?? 0) < 0) {
    throw new WorkerPayError('A payment cannot have a negative part');
  }

  const alreadyCents = sumCents(existing.map((p) => toCents(paymentSettlesWorker(p))));
  const outstandingCents = toCents(accrued) - alreadyCents;
  if (outstandingCents <= 0) {
    throw new WorkerPayError('Nothing is currently owed to this worker');
  }
  if (!opts.allowOverpayment && toCents(settles) > outstandingCents) {
    throw new WorkerPayError(
      `That is more than the ${kes(outstandingCents)} currently owed`,
    );
  }
}

/**
 * What every worker has accrued from attendance, all-time.
 *
 * Deliberately independent of services/finance.ts's LabourCostSource setting:
 * that setting decides how wages are counted for BUDGET purposes (avoiding
 * double-counting if payouts are also logged as expenses); this is the
 * separate question of what cash is actually owed to the person, which is
 * always attendance-accrued regardless of how the budget report treats it.
 */
export async function accruedByWorker(workerIds?: string[]): Promise<Map<string, number>> {
  const rows = await prisma.attendanceRecord.groupBy({
    by: ['workerId'],
    where: { labourCost: { not: null }, ...(workerIds ? { workerId: { in: workerIds } } : {}) },
    _sum: { labourCost: true },
  });
  return new Map(rows.map((r) => [r.workerId, Number(r._sum.labourCost ?? 0)]));
}
