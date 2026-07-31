import { Prisma, type InvoiceStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { fromCents, lineTotalCents, pctOfCents, sumCents, toCents, type MoneyLike } from './money';

// ---- Company / invoicing configuration (Setting rows, same pattern as finance) ----

export interface CompanyBank {
  name: string;
  branch: string;
  accountName: string;
  accountNo: string;
  swift: string;
  mpesaPaybill: string;
}

export interface CompanyProfile {
  name: string;
  addressLines: string[];
  phone: string;
  email: string;
  kraPin: string;
  vatRegistered: boolean;
  bank: CompanyBank;
  logoUrl: string | null;
}

export interface InvoicingConfig {
  invoicePrefix: string;
  receiptPrefix: string;
  numberPadding: number;
  vatRatePct: number;
  defaultRetentionPct: number;
  defaultPaymentTermsDays: number;
  footerNote: string;
}

export const DEFAULT_COMPANY_PROFILE: CompanyProfile = {
  name: 'Alken Decor',
  addressLines: [],
  phone: '',
  email: '',
  kraPin: '',
  vatRegistered: true,
  bank: { name: '', branch: '', accountName: '', accountNo: '', swift: '', mpesaPaybill: '' },
  logoUrl: null,
};

export const DEFAULT_INVOICING_CONFIG: InvoicingConfig = {
  invoicePrefix: 'ALK',
  receiptPrefix: 'RCT',
  numberPadding: 6,
  vatRatePct: 16, // Kenyan standard rate
  defaultRetentionPct: 5,
  defaultPaymentTermsDays: 30,
  footerNote: '',
};

export async function getCompanyProfile(): Promise<CompanyProfile> {
  const row = await prisma.setting.findUnique({ where: { key: 'companyProfile' } });
  const v = (row?.value ?? {}) as Partial<CompanyProfile>;
  return {
    ...DEFAULT_COMPANY_PROFILE,
    ...v,
    addressLines: Array.isArray(v.addressLines) ? v.addressLines : [],
    bank: { ...DEFAULT_COMPANY_PROFILE.bank, ...(v.bank ?? {}) },
  };
}

export async function getInvoicingConfig(): Promise<InvoicingConfig> {
  const row = await prisma.setting.findUnique({ where: { key: 'invoicing' } });
  return { ...DEFAULT_INVOICING_CONFIG, ...((row?.value ?? {}) as Partial<InvoicingConfig>) };
}

// ---- The computation ----

export interface LineInput {
  quantity: MoneyLike;
  unitPrice: MoneyLike;
  taxable?: boolean;
}

export interface InvoiceTotalsInput {
  lines: LineInput[];
  vatRatePct: MoneyLike;
  retentionRatePct: MoneyLike;
  vatInclusive?: boolean;
}

export interface InvoiceTotals {
  lineTotalsCents: number[]; // parallel to input.lines
  subtotalCents: number; // ex-VAT
  vatAmountCents: number;
  grossTotalCents: number;
  retentionAmountCents: number;
  netPayableCents: number; // what the client pays NOW
}

/**
 * The single authoritative implementation of invoice arithmetic.
 *
 * The PDF renderer must never recompute these — it prints the stored columns —
 * and the browser's copy in lib/invoiceMath.ts is a preview only. Three
 * implementations of one formula is three chances to disagree, and the one
 * that would be wrong is the one on the legal document.
 *
 * The ordering below is not arbitrary; each step has a trap in it.
 */
export function computeInvoiceTotals(input: InvoiceTotalsInput): InvoiceTotals {
  // 1. Round PER LINE, then sum — not "sum exactly, round once at the end".
  //    The invoice prints a line-total column; if that column does not add up
  //    to the printed subtotal, the client stops trusting the document.
  const lineTotalsCents = input.lines.map((l) => lineTotalCents(l.quantity, l.unitPrice));

  // 2. Subtotal is a plain sum of values already at 2dp — nothing to round.
  const grossOfLines = sumCents(lineTotalsCents);
  const taxableOfLines = sumCents(
    lineTotalsCents.filter((_, i) => input.lines[i].taxable !== false),
  );

  let subtotalCents: number;
  let vatAmountCents: number;

  if (input.vatInclusive) {
    // 3a. Inclusive pricing: derive VAT by SUBTRACTION so the three printed
    //     figures always reconcile exactly back to the quoted amount.
    const taxableNet = new Prisma.Decimal(taxableOfLines)
      .dividedBy(
        new Prisma.Decimal(1).plus(new Prisma.Decimal(input.vatRatePct ?? 0).dividedBy(100)),
      )
      .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
      .toNumber();
    vatAmountCents = taxableOfLines - taxableNet;
    subtotalCents = grossOfLines - vatAmountCents;
  } else {
    // 3b. VAT is computed ONCE on the taxable subtotal, never per line and
    //     then summed — per-line VAT summed produces a different figure that
    //     disagrees with the single "VAT @ 16%" line the invoice prints.
    subtotalCents = grossOfLines;
    vatAmountCents = pctOfCents(taxableOfLines, input.vatRatePct);
  }

  const grossTotalCents = subtotalCents + vatAmountCents;

  // 4. THE TRAP: retention is withheld against the VAT-EXCLUSIVE subtotal.
  //    Retention holds back part of the contractor's *work value* pending
  //    defects liability. VAT is a tax that must be remitted to KRA whether or
  //    not the client has released retention, so retaining a slice of it both
  //    over-withholds from the contractor and under-remits the tax.
  //       retention = round(subtotal   * rate)   <- correct
  //       retention = round(grossTotal * rate)   <- WRONG, over-withholds by the VAT rate
  const retentionAmountCents = pctOfCents(subtotalCents, input.retentionRatePct);

  const netPayableCents = grossTotalCents - retentionAmountCents;

  return {
    lineTotalsCents,
    subtotalCents,
    vatAmountCents,
    grossTotalCents,
    retentionAmountCents,
    netPayableCents,
  };
}

// ---- Balances & status ----

/**
 * Balances are struck against netPayable, not grossTotal: the client was
 * never asked to pay the retained slice on this invoice. Retention is billed
 * later as its own RETENTION-type invoice.
 */
export function invoiceBalanceCents(netPayableCents: number, paidCents: number): number {
  return netPayableCents - paidCents;
}

/** Status is DERIVED from payments, never set by hand. DRAFT and VOID are sticky. */
export function deriveStatus(
  current: InvoiceStatus,
  netPayableCents: number,
  paidCents: number,
): InvoiceStatus {
  if (current === 'DRAFT' || current === 'VOID') return current;
  if (paidCents <= 0) return 'ISSUED';
  if (paidCents >= netPayableCents) return 'PAID';
  return 'PARTIALLY_PAID';
}

export function isOverdue(dueDate: Date, balanceCents: number, asOf: Date = new Date()): boolean {
  return balanceCents > 0 && dueDate.getTime() < startOfDay(asOf).getTime();
}

export function daysOverdue(dueDate: Date, balanceCents: number, asOf: Date = new Date()): number {
  if (!isOverdue(dueDate, balanceCents, asOf)) return 0;
  return Math.floor((startOfDay(asOf).getTime() - dueDate.getTime()) / 86_400_000);
}

export type AgingBucket = 'CURRENT' | 'D1_30' | 'D31_60' | 'D61_90' | 'D90_PLUS';

export function agingBucket(
  dueDate: Date,
  balanceCents: number,
  asOf: Date = new Date(),
): AgingBucket {
  const d = daysOverdue(dueDate, balanceCents, asOf);
  if (d <= 0) return 'CURRENT';
  if (d <= 30) return 'D1_30';
  if (d <= 60) return 'D31_60';
  if (d <= 90) return 'D61_90';
  return 'D90_PLUS';
}

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

// ---- Persistence helpers ----

/**
 * Invoices that are "live" for receivables purposes: issued and not voided.
 * Drafts are not debts and voided invoices are not either.
 */
export const LIVE_INVOICE_STATUSES: InvoiceStatus[] = ['ISSUED', 'PARTIALLY_PAID', 'PAID'];

/** Recomputes a DRAFT invoice's totals from its lines and persists them. */
export async function recalcDraft(tx: Prisma.TransactionClient, invoiceId: string): Promise<void> {
  const inv = await tx.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: { lines: { orderBy: { sortOrder: 'asc' } } },
  });
  const totals = computeInvoiceTotals({
    lines: inv.lines,
    vatRatePct: inv.vatRatePct,
    retentionRatePct: inv.retentionRatePct,
    vatInclusive: inv.vatInclusive,
  });
  await Promise.all(
    inv.lines.map((l, i) =>
      tx.invoiceLine.update({
        where: { id: l.id },
        data: { lineTotal: fromCents(totals.lineTotalsCents[i]) },
      }),
    ),
  );
  await tx.invoice.update({
    where: { id: invoiceId },
    data: {
      subtotal: fromCents(totals.subtotalCents),
      vatAmount: fromCents(totals.vatAmountCents),
      grossTotal: fromCents(totals.grossTotalCents),
      retentionAmount: fromCents(totals.retentionAmountCents),
      netPayable: fromCents(totals.netPayableCents),
    },
  });
}

/** Recomputes and persists an invoice's status from its live (non-void) payments. */
export async function syncInvoiceStatus(
  tx: Prisma.TransactionClient,
  invoiceId: string,
): Promise<InvoiceStatus> {
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  const agg = await tx.payment.aggregate({
    where: { invoiceId, voidedAt: null },
    _sum: { amount: true },
  });
  const next = deriveStatus(inv.status, toCents(inv.netPayable), toCents(agg._sum.amount));
  if (next !== inv.status) {
    await tx.invoice.update({ where: { id: invoiceId }, data: { status: next } });
  }
  return next;
}

// ---- Receivables ----

export interface ProjectReceivables {
  contractValue: number;
  invoicedNet: number; // sum of netPayable across live invoices
  invoicedGross: number;
  retentionHeld: number;
  receiptedAgainstInvoices: number;
  onAccount: number; // payments with no invoice
  totalCollected: number;
  arOutstanding: number; // sum of positive invoice balances
  arOverdue: number;
  oldestOverdueDays: number | null;
  counts: { draft: number; issued: number; partiallyPaid: number; paid: number; overdue: number };
}

/** One project's receivables position. Fixed query count — no N+1. */
export async function projectReceivables(projectId: string): Promise<ProjectReceivables> {
  const [project, invoices, paidByInvoice, onAccountAgg] = await Promise.all([
    prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { contractValue: true },
    }),
    prisma.invoice.findMany({
      where: { projectId },
      select: {
        id: true,
        status: true,
        dueDate: true,
        netPayable: true,
        grossTotal: true,
        retentionAmount: true,
      },
    }),
    prisma.payment.groupBy({
      by: ['invoiceId'],
      where: { projectId, voidedAt: null, invoiceId: { not: null } },
      _sum: { amount: true },
    }),
    prisma.payment.aggregate({
      where: { projectId, voidedAt: null, invoiceId: null },
      _sum: { amount: true },
    }),
  ]);

  const paidMap = new Map(paidByInvoice.map((r) => [r.invoiceId!, toCents(r._sum.amount)]));
  const counts = { draft: 0, issued: 0, partiallyPaid: 0, paid: 0, overdue: 0 };

  let invoicedNet = 0;
  let invoicedGross = 0;
  let retentionHeld = 0;
  let receipted = 0;
  let arOutstanding = 0;
  let arOverdue = 0;
  let oldestOverdueDays: number | null = null;

  for (const inv of invoices) {
    if (inv.status === 'DRAFT') counts.draft++;
    if (inv.status === 'ISSUED') counts.issued++;
    if (inv.status === 'PARTIALLY_PAID') counts.partiallyPaid++;
    if (inv.status === 'PAID') counts.paid++;
    if (!LIVE_INVOICE_STATUSES.includes(inv.status)) continue;

    const net = toCents(inv.netPayable);
    const paid = paidMap.get(inv.id) ?? 0;
    const balance = invoiceBalanceCents(net, paid);

    invoicedNet += net;
    invoicedGross += toCents(inv.grossTotal);
    retentionHeld += toCents(inv.retentionAmount);
    receipted += paid;
    if (balance > 0) arOutstanding += balance;
    if (isOverdue(inv.dueDate, balance)) {
      counts.overdue++;
      arOverdue += balance;
      const d = daysOverdue(inv.dueDate, balance);
      oldestOverdueDays = oldestOverdueDays === null ? d : Math.max(oldestOverdueDays, d);
    }
  }

  const onAccount = toCents(onAccountAgg._sum.amount);
  const c = (n: number) => n / 100;
  return {
    contractValue: Number(project.contractValue),
    invoicedNet: c(invoicedNet),
    invoicedGross: c(invoicedGross),
    retentionHeld: c(retentionHeld),
    receiptedAgainstInvoices: c(receipted),
    onAccount: c(onAccount),
    totalCollected: c(receipted + onAccount),
    arOutstanding: c(arOutstanding),
    arOverdue: c(arOverdue),
    oldestOverdueDays,
    counts,
  };
}

export interface CompanyReceivables {
  totalAr: number;
  totalOverdue: number;
  retentionHeld: number;
  buckets: Record<AgingBucket, number>;
}

/**
 * Cross-project receivables in a fixed number of queries, for the company
 * dashboard and the A/R register.
 */
export async function companyReceivables(projectIds?: string[]): Promise<CompanyReceivables> {
  const where: Prisma.InvoiceWhereInput = {
    status: { in: LIVE_INVOICE_STATUSES },
    ...(projectIds ? { projectId: { in: projectIds } } : {}),
  };
  const [invoices, paidByInvoice] = await Promise.all([
    prisma.invoice.findMany({
      where,
      select: { id: true, dueDate: true, netPayable: true, retentionAmount: true },
    }),
    prisma.payment.groupBy({
      by: ['invoiceId'],
      where: { voidedAt: null, invoiceId: { not: null }, invoice: where },
      _sum: { amount: true },
    }),
  ]);

  const paidMap = new Map(paidByInvoice.map((r) => [r.invoiceId!, toCents(r._sum.amount)]));
  const buckets: Record<AgingBucket, number> = {
    CURRENT: 0,
    D1_30: 0,
    D31_60: 0,
    D61_90: 0,
    D90_PLUS: 0,
  };
  let totalAr = 0;
  let totalOverdue = 0;
  let retentionHeld = 0;

  for (const inv of invoices) {
    retentionHeld += toCents(inv.retentionAmount);
    const balance = invoiceBalanceCents(toCents(inv.netPayable), paidMap.get(inv.id) ?? 0);
    if (balance <= 0) continue;
    totalAr += balance;
    buckets[agingBucket(inv.dueDate, balance)] += balance;
    if (isOverdue(inv.dueDate, balance)) totalOverdue += balance;
  }

  const c = (n: number) => n / 100;
  return {
    totalAr: c(totalAr),
    totalOverdue: c(totalOverdue),
    retentionHeld: c(retentionHeld),
    buckets: {
      CURRENT: c(buckets.CURRENT),
      D1_30: c(buckets.D1_30),
      D31_60: c(buckets.D31_60),
      D61_90: c(buckets.D61_90),
      D90_PLUS: c(buckets.D90_PLUS),
    },
  };
}
