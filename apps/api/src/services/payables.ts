import { kes, sumCents, toCents } from './money';
import { prisma } from '../lib/prisma';
import { agingBucket, daysOverdue, isOverdue, type AgingBucket } from './invoicing';

/**
 * Payables: what we owe suppliers, and what we have paid so far.
 *
 * A supplier's bill is very often settled in instalments — a deposit to
 * release the delivery, the balance when the client's money lands. So "paid"
 * is not a flag. What is outstanding on a cost is its amount less every
 * payment recorded against it, computed on demand.
 *
 * Nothing here stores a running balance. A stored total is a second source of
 * truth that can drift from the payments it claims to summarise, and
 * reconciling those two numbers is the argument this module exists to settle.
 *
 * ONE RULE GOVERNS WHAT IS ON THE LEDGER: a cost is a payable only if it names
 * a supplier. Petty cash, fuel, wages handed out on site — money that is
 * already gone — carries no supplier and is never reported as owed. That is
 * also what keeps every expense recorded before suppliers existed from
 * suddenly reading as unpaid.
 *
 * All arithmetic is in integer cents, per services/money.ts.
 */

export type { AgingBucket };

/**
 * Tax treatment of what we buy.
 *
 * Every rate here is configuration, not a constant in the code. Rates change
 * by finance act, they differ by what is being bought, and whether this
 * company is an appointed withholding agent at all is a fact about the
 * company, not about the software. Defaults are deliberately conservative:
 * withholding defaults to ZERO, so nothing is ever deducted from a supplier
 * until somebody sets a rate on purpose.
 */
export interface PurchaseTaxConfig {
  /** Standard input-VAT rate offered when entering a supplier bill. */
  vatRatePct: number;
  /** Whether supplier figures are typed VAT-inclusive by default. */
  billsIncludeVat: boolean;
  /** Default withholding tax rate on a supplier payment. Zero unless set. */
  defaultWhtRatePct: number;
  /** Default withholding VAT rate. Only for appointed agents; zero unless set. */
  defaultWhtVatRatePct: number;
  /** Whether this company withholds at all. Off until switched on deliberately. */
  withholdingAgent: boolean;
}

export const DEFAULT_PURCHASE_TAX: PurchaseTaxConfig = {
  vatRatePct: 16, // Kenyan standard rate
  billsIncludeVat: true,
  defaultWhtRatePct: 0,
  defaultWhtVatRatePct: 0,
  withholdingAgent: false,
};

export async function getPurchaseTaxConfig(): Promise<PurchaseTaxConfig> {
  const row = await prisma.setting.findUnique({ where: { key: 'purchaseTax' } });
  return { ...DEFAULT_PURCHASE_TAX, ...((row?.value ?? {}) as Partial<PurchaseTaxConfig>) };
}

/** A cost that may be owed. `supplierId` null means it is not on the ledger. */
export interface PayableCost {
  id: string;
  supplierId: string | null;
  /** GROSS, as printed on the supplier's invoice. This is what we owe them. */
  amount: number;
  /** Input VAT contained within `amount`. The ex-VAT cost is amount − vatAmount. */
  vatAmount?: number;
  /** Whether the supplier issued a tax invoice, so the VAT can be reclaimed. */
  taxInvoice?: boolean;
  /** Falls back to the expense date when the supplier gave no terms. */
  dueDate: Date | null;
  expenseDate: Date;
}

/**
 * One payment. `amount` is cash the supplier received; the withholding fields
 * are tax deducted from them and owed to KRA instead.
 */
export interface PayablePayment {
  amount: number;
  whtAmount?: number;
  whtVatAmount?: number;
}

export interface PayablePosition {
  /** Gross total of the supplier's bill. */
  amount: number;
  /** Input VAT within the bill. */
  vatAmount: number;
  /** amount − vatAmount: the cost before recoverable tax. */
  netAmount: number;
  /** Input VAT that may actually be reclaimed — nil without a tax invoice. */
  reclaimableVat: number;
  /** Cash that reached the supplier. */
  cashPaid: number;
  /** Tax withheld from them and owed to KRA. */
  taxWithheld: number;
  /** cashPaid + taxWithheld: what has settled the bill. */
  paid: number;
  /** amount − paid. Never negative; see `overpaid`. */
  outstanding: number;
  /** Paid beyond the bill. Surfaced separately so it cannot hide as a credit. */
  overpaid: number;
  paidPct: number;
  settled: boolean;
  overdue: boolean;
  daysOverdue: number;
  agingBucket: AgingBucket;
}

/** Cash + withheld tax. What a payment actually takes off the bill. */
export function paymentSettles(p: PayablePayment): number {
  return kes(toCents(p.amount) + toCents(p.whtAmount ?? 0) + toCents(p.whtVatAmount ?? 0));
}

/**
 * When a supplier gave no payment terms, the money is treated as due on the
 * day of the purchase. Cash-on-delivery is the honest default in this trade,
 * and it errs towards showing a debt as due rather than hiding it.
 */
export function effectiveDueDate(cost: Pick<PayableCost, 'dueDate' | 'expenseDate'>): Date {
  return cost.dueDate ?? cost.expenseDate;
}

/** Whether a cost belongs on the payables ledger at all. */
export function isPayable(cost: Pick<PayableCost, 'supplierId'>): boolean {
  return cost.supplierId != null;
}

/**
 * The position on one supplier bill.
 *
 * Withheld tax settles the bill exactly as cash does. A supplier billing
 * 500,000 with 15,000 withheld is paid in full on 485,000 — the remaining
 * 15,000 is owed to KRA, not to them. Counting only the cash would leave the
 * bill permanently 15,000 short and invite somebody to pay it a second time.
 *
 * Overpayment is reported, not netted away. Paying 520,000 against a 500,000
 * bill is either a keying error or a credit the supplier now owes back, and
 * both need somebody to look — folding it into a negative outstanding would
 * quietly reduce what the next bill appears to cost.
 */
export function payablePosition(
  cost: PayableCost,
  payments: PayablePayment[],
  asOf: Date = new Date(),
): PayablePosition {
  const amountCents = toCents(cost.amount);
  const vatCents = toCents(cost.vatAmount ?? 0);
  const cashCents = sumCents(payments.map((p) => toCents(p.amount)));
  const withheldCents = sumCents(
    payments.map((p) => toCents(p.whtAmount ?? 0) + toCents(p.whtVatAmount ?? 0)),
  );
  const paidCents = cashCents + withheldCents;
  const diff = amountCents - paidCents;
  const outstandingCents = Math.max(0, diff);
  const overpaidCents = Math.max(0, -diff);
  const due = effectiveDueDate(cost);

  return {
    amount: kes(amountCents),
    vatAmount: kes(vatCents),
    netAmount: kes(amountCents - vatCents),
    // Input VAT is only recoverable against a valid tax invoice. Without one
    // the VAT is simply part of what the job cost, and reporting it as
    // reclaimable would overstate what KRA actually owes back.
    reclaimableVat: kes(cost.taxInvoice ? vatCents : 0),
    cashPaid: kes(cashCents),
    taxWithheld: kes(withheldCents),
    paid: kes(paidCents),
    outstanding: kes(outstandingCents),
    overpaid: kes(overpaidCents),
    // A bill worth nothing is fully paid by definition, not 0% paid.
    paidPct: amountCents > 0 ? Math.round((paidCents / amountCents) * 1000) / 10 : 100,
    settled: outstandingCents === 0,
    overdue: isOverdue(due, outstandingCents, asOf),
    daysOverdue: daysOverdue(due, outstandingCents, asOf),
    agingBucket: agingBucket(due, outstandingCents, asOf),
  };
}

export interface SupplierPosition {
  supplierId: string;
  /** Number of bills with anything still outstanding. */
  openBills: number;
  billed: number;
  paid: number;
  cashPaid: number;
  taxWithheld: number;
  reclaimableVat: number;
  outstanding: number;
  overpaid: number;
  overdue: number;
  /** Days past due of the oldest unpaid bill, or null when nothing is late. */
  oldestOverdueDays: number | null;
  aging: Record<AgingBucket, number>;
}

const EMPTY_AGING = (): Record<AgingBucket, number> => ({
  CURRENT: 0,
  D1_30: 0,
  D31_60: 0,
  D61_90: 0,
  D90_PLUS: 0,
});

/**
 * Roll costs up per supplier: what they billed, what we paid, what is late.
 *
 * Costs without a supplier are skipped rather than grouped under a blank key —
 * they are not debts, and a phantom "unknown supplier" row would invite
 * somebody to try to pay it.
 */
export function supplierPositions(
  costs: PayableCost[],
  paymentsByCost: Map<string, PayablePayment[]>,
  asOf: Date = new Date(),
): SupplierPosition[] {
  const bySupplier = new Map<string, SupplierPosition>();

  for (const cost of costs) {
    if (!isPayable(cost)) continue;
    const supplierId = cost.supplierId!;
    const pos = payablePosition(cost, paymentsByCost.get(cost.id) ?? [], asOf);

    const acc =
      bySupplier.get(supplierId) ??
      ({
        supplierId,
        openBills: 0,
        billed: 0,
        paid: 0,
        cashPaid: 0,
        taxWithheld: 0,
        reclaimableVat: 0,
        outstanding: 0,
        overpaid: 0,
        overdue: 0,
        oldestOverdueDays: null,
        aging: EMPTY_AGING(),
      } satisfies SupplierPosition);

    acc.billed = kes(toCents(acc.billed) + toCents(pos.amount));
    acc.paid = kes(toCents(acc.paid) + toCents(pos.paid));
    acc.cashPaid = kes(toCents(acc.cashPaid) + toCents(pos.cashPaid));
    acc.taxWithheld = kes(toCents(acc.taxWithheld) + toCents(pos.taxWithheld));
    acc.reclaimableVat = kes(toCents(acc.reclaimableVat) + toCents(pos.reclaimableVat));
    acc.outstanding = kes(toCents(acc.outstanding) + toCents(pos.outstanding));
    acc.overpaid = kes(toCents(acc.overpaid) + toCents(pos.overpaid));
    if (!pos.settled) acc.openBills += 1;
    if (pos.overdue) {
      acc.overdue = kes(toCents(acc.overdue) + toCents(pos.outstanding));
      acc.oldestOverdueDays = Math.max(acc.oldestOverdueDays ?? 0, pos.daysOverdue);
    }
    // Only money still owed is aged. A settled bill has nothing to chase.
    if (pos.outstanding > 0) {
      acc.aging[pos.agingBucket] = kes(
        toCents(acc.aging[pos.agingBucket]) + toCents(pos.outstanding),
      );
    }

    bySupplier.set(supplierId, acc);
  }

  // Biggest debt first: that is the one that stops a delivery tomorrow.
  return [...bySupplier.values()].sort((a, b) => b.outstanding - a.outstanding);
}

export interface PayablesSummary {
  billed: number;
  paid: number;
  cashPaid: number;
  /** Tax deducted from suppliers, which is owed to KRA. */
  taxWithheld: number;
  /** Input VAT backed by a tax invoice, and so recoverable. */
  reclaimableVat: number;
  outstanding: number;
  overpaid: number;
  overdue: number;
  supplierCount: number;
  openBills: number;
  oldestOverdueDays: number | null;
  aging: Record<AgingBucket, number>;
}

/** The company-wide position: one number for "what do I owe right now". */
export function payablesSummary(positions: SupplierPosition[]): PayablesSummary {
  const aging = EMPTY_AGING();
  let billed = 0;
  let paid = 0;
  let cashPaid = 0;
  let taxWithheld = 0;
  let reclaimableVat = 0;
  let outstanding = 0;
  let overpaid = 0;
  let overdue = 0;
  let openBills = 0;
  let oldestOverdueDays: number | null = null;

  for (const p of positions) {
    billed = kes(toCents(billed) + toCents(p.billed));
    paid = kes(toCents(paid) + toCents(p.paid));
    cashPaid = kes(toCents(cashPaid) + toCents(p.cashPaid));
    taxWithheld = kes(toCents(taxWithheld) + toCents(p.taxWithheld));
    reclaimableVat = kes(toCents(reclaimableVat) + toCents(p.reclaimableVat));
    outstanding = kes(toCents(outstanding) + toCents(p.outstanding));
    overpaid = kes(toCents(overpaid) + toCents(p.overpaid));
    overdue = kes(toCents(overdue) + toCents(p.overdue));
    openBills += p.openBills;
    if (p.oldestOverdueDays != null) {
      oldestOverdueDays = Math.max(oldestOverdueDays ?? 0, p.oldestOverdueDays);
    }
    for (const bucket of Object.keys(aging) as AgingBucket[]) {
      aging[bucket] = kes(toCents(aging[bucket]) + toCents(p.aging[bucket]));
    }
  }

  return {
    billed,
    paid,
    cashPaid,
    taxWithheld,
    reclaimableVat,
    outstanding,
    overpaid,
    overdue,
    // Only suppliers actually owed something count as suppliers to pay.
    supplierCount: positions.filter((p) => p.outstanding > 0).length,
    openBills,
    oldestOverdueDays,
    aging,
  };
}

// ---- Tax on a supplier bill ----

/**
 * Split a supplier's figure into net and VAT.
 *
 * `inclusive` says which figure was typed. A supplier's invoice is normally
 * quoted VAT-inclusive in this trade, but a quotation is often ex-VAT, and
 * guessing wrong misstates the cost by the whole VAT rate.
 */
export function splitVat(
  figure: number,
  vatRatePct: number,
  inclusive: boolean,
): { gross: number; net: number; vat: number } {
  const figureCents = toCents(figure);
  if (!vatRatePct) return { gross: kes(figureCents), net: kes(figureCents), vat: 0 };

  if (inclusive) {
    // net = gross / (1 + rate); VAT is the remainder, so the two always add
    // back to exactly the figure the supplier printed.
    const netCents = Math.round(figureCents / (1 + vatRatePct / 100));
    return { gross: kes(figureCents), net: kes(netCents), vat: kes(figureCents - netCents) };
  }
  const vatCents = Math.round((figureCents * vatRatePct) / 100);
  return { gross: kes(figureCents + vatCents), net: kes(figureCents), vat: kes(vatCents) };
}

/**
 * Withholding is computed on the VAT-EXCLUSIVE value of the supply, not on the
 * gross. Applying the rate to a VAT-inclusive figure over-withholds by the VAT
 * rate — money taken from a supplier who is entitled to it.
 */
export function withholdingOn(
  netAmount: number,
  ratePct: number,
): number {
  if (!ratePct) return 0;
  return kes(Math.round((toCents(netAmount) * ratePct) / 100));
}

export class PayableError extends Error {}

/**
 * Check a payment before it is recorded.
 *
 * Refuses a payment against a cost with no supplier: that cost is not on the
 * ledger, so a payment against it would be money recorded twice — once as the
 * expense itself and once as settling it.
 *
 * The comparison is against cash PLUS withheld tax, because that is what
 * clears the bill. Checking cash alone would reject a payment that settles it
 * exactly, purely because part of the money went to KRA.
 */
export function assertPaymentAllowed(
  cost: PayableCost,
  existing: PayablePayment[],
  payment: PayablePayment,
  opts: { allowOverpayment?: boolean } = {},
): void {
  if (!isPayable(cost)) {
    throw new PayableError(
      'This cost has no supplier, so there is nothing owed against it. Set a supplier first.',
    );
  }
  const settles = paymentSettles(payment);
  if (!Number.isFinite(settles) || settles <= 0) {
    throw new PayableError('A payment must be greater than zero');
  }
  if (payment.amount < 0 || (payment.whtAmount ?? 0) < 0 || (payment.whtVatAmount ?? 0) < 0) {
    throw new PayableError('A payment cannot have a negative part');
  }

  const alreadyCents = sumCents(existing.map((p) => toCents(paymentSettles(p))));
  const outstandingCents = toCents(cost.amount) - alreadyCents;
  if (outstandingCents <= 0) {
    throw new PayableError('This bill is already paid in full');
  }
  if (!opts.allowOverpayment && toCents(settles) > outstandingCents) {
    throw new PayableError(
      `That is more than the ${kes(outstandingCents)} still outstanding on this bill`,
    );
  }
}
