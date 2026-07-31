import type { Prisma, Contract, Variation } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { computeInvoiceTotals } from './invoicing';
import { fromCents, kes, pctOfCents, toCents, type MoneyLike } from './money';

/**
 * The pre-project pipeline: Lead -> Quotation -> Contract -> Project.
 *
 * Quotation arithmetic deliberately reuses computeInvoiceTotals() rather than
 * repeating it — a quotation is an invoice's calculation without retention, and
 * two implementations of the same VAT rounding would eventually disagree.
 */

// ---- Configuration (Setting row, same pattern as invoicing) ----

export interface PipelineConfig {
  quotationPrefix: string;
  contractPrefix: string;
  projectPrefix: string;
  /** How long a quotation stands before it needs re-pricing. */
  quotationValidityDays: number;
  quotationTermsText: string;
  /**
   * The contract's standard conditions. Editable boilerplate rather than
   * hardcoded text: the particulars (sum, dates, retention, DLP) are rendered
   * from the actual record, and this covers only the wording around them.
   */
  contractTermsText: string;
}

export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  quotationPrefix: 'QTN',
  contractPrefix: 'CTR',
  projectPrefix: 'PRJ',
  quotationValidityDays: 30,
  quotationTermsText: [
    'Prices are valid for the period stated above and are subject to re-quotation thereafter.',
    'Rates are based on the scope described. Any variation to that scope will be quoted separately and must be approved in writing before the work is carried out.',
    'Materials remain the property of the Contractor until paid for in full.',
  ].join('\n'),
  contractTermsText: [
    '1. The Contractor shall carry out and complete the Works described in the Schedule of Works with due care and skill, and in accordance with the drawings and specifications issued by the Employer.',
    '2. The Contract Sum stated in the Particulars is the full consideration for the Works. No adjustment shall be made to it except by a Variation Order approved in writing by both parties.',
    '3. Payment shall be made against invoices issued by the Contractor in accordance with the payment terms stated in the Particulars.',
    '4. The Employer shall retain the percentage stated in the Particulars. Retention is calculated on the value of the Works excluding VAT, and is released after the Defects Liability Period has expired and all notified defects have been made good.',
    '5. The Contractor shall make good, at their own cost, any defect in workmanship or materials notified during the Defects Liability Period stated in the Particulars, which runs from the date of practical completion.',
    '6. The Contractor is responsible for the safety of their personnel on site and shall maintain adequate insurance for the duration of the Works.',
    '7. Either party may terminate this Contract for a material breach that remains unremedied fourteen (14) days after written notice. On termination the Contractor shall be paid for work properly executed to the date of termination.',
    '8. This Contract is governed by the laws of Kenya. Any dispute shall first be referred to good-faith negotiation between the parties and, failing settlement within thirty (30) days, to arbitration in Nairobi.',
  ].join('\n\n'),
};

export async function getPipelineConfig(): Promise<PipelineConfig> {
  const row = await prisma.setting.findUnique({ where: { key: 'pipeline' } });
  return { ...DEFAULT_PIPELINE_CONFIG, ...((row?.value ?? {}) as Partial<PipelineConfig>) };
}

// ---- Quotation arithmetic ----

export interface QuotationLineInput {
  quantity: MoneyLike;
  unitPrice: MoneyLike;
  taxable?: boolean;
}

export interface QuotationTotals {
  lineTotalsCents: number[];
  subtotalCents: number;
  vatAmountCents: number;
  totalCents: number;
}

export function computeQuotationTotals(
  lines: QuotationLineInput[],
  vatRatePct: MoneyLike,
): QuotationTotals {
  // retentionRatePct: 0 — retention is a contract concept, not a quotation one.
  const t = computeInvoiceTotals({ lines, vatRatePct, retentionRatePct: 0 });
  return {
    lineTotalsCents: t.lineTotalsCents,
    subtotalCents: t.subtotalCents,
    vatAmountCents: t.vatAmountCents,
    totalCents: t.grossTotalCents,
  };
}

/** Recomputes a DRAFT quotation's totals from its lines and persists them. */
export async function recalcQuotation(
  tx: Prisma.TransactionClient,
  quotationId: string,
): Promise<void> {
  const q = await tx.quotation.findUniqueOrThrow({
    where: { id: quotationId },
    include: { lines: { orderBy: { sortOrder: 'asc' } } },
  });
  const t = computeQuotationTotals(q.lines, q.vatRatePct);
  await Promise.all(
    q.lines.map((l, i) =>
      tx.quotationLine.update({
        where: { id: l.id },
        data: { lineTotal: fromCents(t.lineTotalsCents[i]) },
      }),
    ),
  );
  await tx.quotation.update({
    where: { id: quotationId },
    data: {
      subtotal: fromCents(t.subtotalCents),
      vatAmount: fromCents(t.vatAmountCents),
      total: fromCents(t.totalCents),
    },
  });
}

// ---- Contract value ----

export interface ContractPosition {
  /** All ex-VAT, matching how Contract.originalValue is stored. */
  originalValue: number;
  approvedVariations: number;
  pendingVariations: number;
  currentValue: number;
  vatRatePct: number;
  vatAmount: number;
  /** currentValue + VAT — the cash figure, and what Project.contractValue holds. */
  grossValue: number;
  retentionPct: number;
  /**
   * Retention that will be held across the job, on the ex-VAT current value.
   *
   * Ex-VAT for the same reason invoices hold it that way: VAT is remitted to
   * KRA in full whether or not retention has been released, so retaining a
   * slice of it would leave the contractor funding the Revenue's cut.
   *
   * A projection, not a balance. What is actually held right now is the sum of
   * retentionAmount on issued invoices — see receivables in services/invoicing.
   */
  retentionAmount: number;
  defectsLiabilityMonths: number;
  /** null until practical completion is recorded — the clock has not started. */
  defectsLiabilityEnds: string | null;
}

type VariationSlice = Pick<Variation, 'amount' | 'status'>;

/**
 * The contract's money position.
 *
 * Only APPROVED variations move the current value. Pending ones are returned
 * separately so the owner can see what is in the pipeline without it being
 * counted as agreed.
 */
export function contractPosition(
  contract: Pick<
    Contract,
    | 'originalValue'
    | 'vatRatePct'
    | 'retentionPct'
    | 'defectsLiabilityMonths'
    | 'practicalCompletionDate'
  >,
  variations: VariationSlice[],
): ContractPosition {
  const originalCents = toCents(contract.originalValue);
  const approvedCents = variations
    .filter((v) => v.status === 'APPROVED')
    .reduce((s, v) => s + toCents(v.amount), 0);
  const pendingCents = variations
    .filter((v) => v.status === 'PENDING')
    .reduce((s, v) => s + toCents(v.amount), 0);
  const currentCents = originalCents + approvedCents;

  const vatRatePct = Number(contract.vatRatePct);
  const vatCents = pctOfCents(currentCents, vatRatePct);
  const retentionPct = Number(contract.retentionPct);
  const retentionCents = pctOfCents(currentCents, retentionPct);

  return {
    originalValue: kes(originalCents),
    approvedVariations: kes(approvedCents),
    pendingVariations: kes(pendingCents),
    currentValue: kes(currentCents),
    vatRatePct,
    vatAmount: kes(vatCents),
    grossValue: kes(currentCents + vatCents),
    retentionPct,
    retentionAmount: kes(retentionCents),
    defectsLiabilityMonths: contract.defectsLiabilityMonths,
    defectsLiabilityEnds: dlpEnd(contract.practicalCompletionDate, contract.defectsLiabilityMonths),
  };
}

/** Defects liability runs from practical completion, not from handover of site. */
export function dlpEnd(practicalCompletion: Date | null, months: number): string | null {
  if (!practicalCompletion) return null;
  const d = new Date(practicalCompletion);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

/**
 * Keeps Project.contractValue in step with the contract it came from.
 *
 * From this phase on, contractValue is derived rather than hand-entered: it is
 * the original value plus approved variations, VAT-inclusive. Gross, because
 * every existing consumer compares it against cash — payments received, budget
 * spent — and those are gross figures.
 *
 * It stays a stored column because finance.ts and analytics.ts read it on every
 * request, and recomputing it there would turn one column read into a join on
 * every dashboard query.
 */
export async function syncProjectContractValue(
  tx: Prisma.TransactionClient,
  contractId: string,
): Promise<void> {
  const contract = await tx.contract.findUniqueOrThrow({
    where: { id: contractId },
    include: { variations: { select: { amount: true, status: true } } },
  });
  if (!contract.projectId) return; // not converted to a project yet
  const pos = contractPosition(contract, contract.variations);
  await tx.project.update({
    where: { id: contract.projectId },
    data: { contractValue: fromCents(toCents(pos.grossValue)) },
  });
}

/** Next variation reference for a contract: VO-001, VO-002, ... */
export async function nextVariationRef(
  tx: Prisma.TransactionClient,
  contractId: string,
): Promise<string> {
  const count = await tx.variation.count({ where: { contractId } });
  return `VO-${String(count + 1).padStart(3, '0')}`;
}

/** Pipeline totals for the dashboard's Project Leads tile. */
export async function leadPipeline(): Promise<{
  open: number;
  openValue: number;
  byStage: Record<string, { count: number; value: number }>;
}> {
  const rows = await prisma.lead.groupBy({
    by: ['stage'],
    _count: true,
    _sum: { estimatedValue: true },
  });
  const byStage: Record<string, { count: number; value: number }> = {};
  let open = 0;
  let openValue = 0;
  for (const r of rows) {
    const value = Number(r._sum.estimatedValue ?? 0);
    byStage[r.stage] = { count: r._count, value };
    // WON and LOST are settled; everything else is still being chased.
    if (r.stage !== 'WON' && r.stage !== 'LOST') {
      open += r._count;
      openValue += value;
    }
  }
  return { open, openValue, byStage };
}
