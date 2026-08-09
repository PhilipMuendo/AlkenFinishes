/**
 * PREVIEW ONLY — the server is the source of truth.
 *
 * This mirrors computeInvoiceTotals() in apps/api/src/services/invoicing.ts so
 * the line editor can show live totals as the user types. Every save
 * overwrites these numbers with the server's, and the PDF renders the server's
 * stored columns. If the two ever disagree, the server is right.
 *
 * The ordering below is deliberate and matches the server exactly:
 *   1. round per line, then sum   (the printed column must equal the subtotal)
 *   2. VAT once on the subtotal   (not per line, then summed)
 *   3. retention on the EX-VAT subtotal, never on gross
 */

export interface PreviewLine {
  quantity: number | string;
  unitPrice: number | string;
  taxable?: boolean;
  /**
   * Overrides quantity × unitPrice, mirroring `fixedLineTotalCents` on the
   * server. Progress-claim lines bill a difference between two cumulative
   * valuations, which is not a product of anything on the line.
   */
  lineTotal?: number | null;
}

export interface PreviewTotals {
  lineTotals: number[];
  subtotal: number;
  vatAmount: number;
  grossTotal: number;
  retentionAmount: number;
  netPayable: number;
}

/** Half-up to whole cents, matching Decimal.ROUND_HALF_UP on the server. */
function toCents(v: number): number {
  return Math.round((v + Number.EPSILON) * 100);
}

const n = (v: number | string): number => {
  const x = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(x) ? x : 0;
};

export function previewInvoiceTotals(
  lines: PreviewLine[],
  vatRatePct: number,
  retentionRatePct: number,
  vatInclusive = false,
): PreviewTotals {
  const lineTotalsCents = lines.map((l) =>
    l.lineTotal == null ? toCents(n(l.quantity) * n(l.unitPrice)) : toCents(l.lineTotal),
  );
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const grossOfLines = sum(lineTotalsCents);
  const taxableOfLines = sum(lineTotalsCents.filter((_, i) => lines[i].taxable !== false));

  let subtotalCents: number;
  let vatCents: number;
  if (vatInclusive) {
    const taxableNet = Math.round(taxableOfLines / (1 + vatRatePct / 100));
    vatCents = taxableOfLines - taxableNet;
    subtotalCents = grossOfLines - vatCents;
  } else {
    subtotalCents = grossOfLines;
    vatCents = Math.round((taxableOfLines * vatRatePct) / 100);
  }

  const grossCents = subtotalCents + vatCents;
  const retentionCents = Math.round((subtotalCents * retentionRatePct) / 100);

  return {
    lineTotals: lineTotalsCents.map((c) => c / 100),
    subtotal: subtotalCents / 100,
    vatAmount: vatCents / 100,
    grossTotal: grossCents / 100,
    retentionAmount: retentionCents / 100,
    netPayable: (grossCents - retentionCents) / 100,
  };
}
