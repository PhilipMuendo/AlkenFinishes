import { prisma } from '../lib/prisma';
import { kes, sumCents, toCents } from './money';
import { LIVE_INVOICE_STATUSES } from './invoicing';

/**
 * The company's tax position.
 *
 * Five separate obligations, deliberately never netted into one number:
 *
 *   1. OUTPUT VAT — VAT charged to clients on issued invoices. Owed to KRA.
 *   2. INPUT VAT  — VAT suppliers charged us, reclaimable only where they
 *                   issued a valid tax invoice.
 *   3. TAX WE WITHHELD from suppliers. Their money, held by us, owed to KRA.
 *   4. TAX WE WITHHELD from staff paid casually/under contract (workers not
 *      run through Payroll). Same idea as (3), same obligation to KRA, kept
 *      separate because it is a different rate on a different population and
 *      collapsing the two would make neither figure traceable to its source.
 *   5. TAX CLIENTS WITHHELD from us. Already remitted on our behalf, and
 *      claimable as a credit — but only against a certificate we actually hold.
 *
 * Netting (3)/(4) against (5) would be wrong in both directions: money we owe
 * KRA is not reduced by credits we have not yet claimed, and a credit we hold
 * is not cancelled by a liability that falls due on a different date. They are
 * reported side by side so none of them are ever confused for another.
 *
 * Everything here is REPORTING. Nothing in this file decides what is legally
 * due — the rates are the user's, set in Settings, and the figures are only as
 * good as what was entered against each bill and receipt.
 *
 * VAT is accrual-based (on invoices issued and bills received), which is the
 * ordinary Kenyan basis. Withholding is cash-based, because tax is only
 * actually withheld at the moment a payment is made.
 */

export interface TaxPeriod {
  from: Date;
  to: Date;
}

export interface VatPosition {
  /** VAT charged to clients on live invoices issued in the period. */
  outputVat: number;
  /** VAT suppliers charged us in the period, whether reclaimable or not. */
  inputVatCharged: number;
  /** The reclaimable slice: bills backed by a supplier tax invoice. */
  inputVatReclaimable: number;
  /** Input VAT with no tax invoice behind it. A cost, not a credit. */
  inputVatUnsupported: number;
  /** outputVat − inputVatReclaimable. Positive means payable to KRA. */
  netVatPayable: number;
  /** Invoices and bills the figures came from, so a total can be traced. */
  invoiceCount: number;
  billCount: number;
}

export interface WithholdingPosition {
  /** Deducted from suppliers and owed to KRA. */
  withheldFromSuppliers: number;
  /** Of that, not yet marked remitted. */
  notYetRemitted: number;
  /** Deducted from casual/contracted staff (not run through Payroll) and owed to KRA. */
  withheldFromStaff: number;
  /** Of that, not yet marked remitted. */
  staffNotYetRemitted: number;
  /** Deducted by clients from what they owed us, remitted on our behalf. */
  withheldByClients: number;
  /** Of that, with no certificate in hand yet — a credit we cannot claim. */
  certificatesOutstanding: number;
  certificatesOutstandingCount: number;
}

export interface TaxPosition {
  period: { from: string; to: string };
  vat: VatPosition;
  withholding: WithholdingPosition;
}

/**
 * A calendar month, which is the Kenyan VAT period. Callers pass explicit
 * dates; this only exists so the default view is the one that matters.
 */
export function monthPeriod(asOf: Date = new Date()): TaxPeriod {
  const from = new Date(asOf.getFullYear(), asOf.getMonth(), 1);
  const to = new Date(asOf.getFullYear(), asOf.getMonth() + 1, 0, 23, 59, 59, 999);
  return { from, to };
}

export async function taxPosition(period: TaxPeriod): Promise<TaxPosition> {
  const { from, to } = period;

  const [invoices, bills, supplierPayments, staffPayments, clientPayments] = await Promise.all([
    // Output VAT: what we charged clients. Drafts have not been issued to
    // anyone and voided invoices charged nothing, so neither is a liability.
    prisma.invoice.findMany({
      where: { status: { in: LIVE_INVOICE_STATUSES }, issueDate: { gte: from, lte: to } },
      select: { vatAmount: true },
    }),
    // Input VAT: what suppliers charged us. Only bills naming a supplier are
    // purchases in this sense; petty cash carries no VAT record. APPROVED
    // only, matching services/finance.ts's "actual spend" rule — a PENDING
    // claim has not been accepted as a cost yet and a REJECTED one never was,
    // so counting either here would overstate this month's VAT position
    // before anyone had looked at the claim.
    prisma.expense.findMany({
      where: { supplierId: { not: null }, status: 'APPROVED', expenseDate: { gte: from, lte: to } },
      select: { vatAmount: true, taxInvoice: true },
    }),
    prisma.supplierPayment.findMany({
      where: { paymentDate: { gte: from, lte: to } },
      select: { whtAmount: true, whtVatAmount: true, whtRemittedAt: true },
    }),
    prisma.workerPayment.findMany({
      where: { paymentDate: { gte: from, lte: to } },
      select: { whtAmount: true, whtRemittedAt: true },
    }),
    prisma.payment.findMany({
      where: { voidedAt: null, paymentDate: { gte: from, lte: to } },
      select: { whtAmount: true, whtVatAmount: true, whtCertReceivedAt: true },
    }),
  ]);

  const outputVat = sumCents(invoices.map((i) => toCents(i.vatAmount)));
  const inputVatCharged = sumCents(bills.map((b) => toCents(b.vatAmount)));
  const inputVatReclaimable = sumCents(
    bills.filter((b) => b.taxInvoice).map((b) => toCents(b.vatAmount)),
  );

  const withheldFromSuppliers = sumCents(
    supplierPayments.map((p) => toCents(p.whtAmount) + toCents(p.whtVatAmount)),
  );
  const notYetRemitted = sumCents(
    supplierPayments
      .filter((p) => p.whtRemittedAt === null)
      .map((p) => toCents(p.whtAmount) + toCents(p.whtVatAmount)),
  );

  const withheldFromStaff = sumCents(staffPayments.map((p) => toCents(p.whtAmount)));
  const staffNotYetRemitted = sumCents(
    staffPayments.filter((p) => p.whtRemittedAt === null).map((p) => toCents(p.whtAmount)),
  );

  const clientWithheld = clientPayments.map((p) => ({
    cents: toCents(p.whtAmount) + toCents(p.whtVatAmount),
    hasCert: p.whtCertReceivedAt !== null,
  }));
  const withheldByClients = sumCents(clientWithheld.map((c) => c.cents));
  const missingCert = clientWithheld.filter((c) => !c.hasCert && c.cents > 0);

  return {
    period: { from: from.toISOString(), to: to.toISOString() },
    vat: {
      outputVat: kes(outputVat),
      inputVatCharged: kes(inputVatCharged),
      inputVatReclaimable: kes(inputVatReclaimable),
      inputVatUnsupported: kes(inputVatCharged - inputVatReclaimable),
      // Can go negative: a month of heavy buying and light billing leaves a
      // credit carried forward, which is a real and reportable outcome.
      netVatPayable: kes(outputVat - inputVatReclaimable),
      invoiceCount: invoices.length,
      billCount: bills.length,
    },
    withholding: {
      withheldFromSuppliers: kes(withheldFromSuppliers),
      notYetRemitted: kes(notYetRemitted),
      withheldFromStaff: kes(withheldFromStaff),
      staffNotYetRemitted: kes(staffNotYetRemitted),
      withheldByClients: kes(withheldByClients),
      certificatesOutstanding: kes(sumCents(missingCert.map((c) => c.cents))),
      certificatesOutstandingCount: missingCert.length,
    },
  };
}

/**
 * Client payments where tax was withheld but no certificate has arrived.
 *
 * Until the certificate is in hand the credit cannot be claimed, so this is
 * money already surrendered to KRA that we cannot yet use. It is a chase list.
 */
export async function outstandingCertificates() {
  const rows = await prisma.payment.findMany({
    where: {
      voidedAt: null,
      whtCertReceivedAt: null,
      OR: [{ whtAmount: { gt: 0 } }, { whtVatAmount: { gt: 0 } }],
    },
    select: {
      id: true,
      receiptNo: true,
      paymentDate: true,
      whtAmount: true,
      whtVatAmount: true,
      project: { select: { id: true, name: true, clientName: true } },
      invoice: { select: { id: true, invoiceNo: true } },
    },
    orderBy: { paymentDate: 'asc' },
    take: 500,
  });

  return rows.map((r) => ({
    id: r.id,
    receiptNo: r.receiptNo,
    paymentDate: r.paymentDate,
    withheld: kes(toCents(r.whtAmount) + toCents(r.whtVatAmount)),
    project: r.project,
    invoice: r.invoice,
    // How long the certificate has been outstanding, which is what decides
    // whether it is worth a phone call.
    daysWaiting: Math.max(
      0,
      Math.floor((Date.now() - r.paymentDate.getTime()) / 86_400_000),
    ),
  }));
}
