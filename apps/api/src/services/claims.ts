import { kes, pctOfCents, sumCents, toCents } from './money';

/**
 * Progress claims.
 *
 * A progress claim states, per item of the priced schedule: what the item is
 * worth, how complete it is TO DATE, and what earlier claims already took. The
 * amount claimed now is the difference. Stating it cumulatively is not a style
 * choice — it is how the claim stays self-correcting: if last month's
 * percentage was optimistic, this month's cumulative figure quietly absorbs the
 * correction instead of compounding it.
 *
 * Nothing here stores "previously claimed". It is a sum over prior invoice
 * lines, computed on demand. A stored copy is a second source of truth that can
 * disagree with the invoices it claims to summarise, and reconciling those two
 * numbers is exactly the argument this feature exists to prevent.
 *
 * All arithmetic is in integer cents, per services/money.ts.
 */

export interface ScheduleLine {
  id: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  /** Contract value of this item, ex-VAT. */
  lineTotal: number;
  taxable: boolean;
  sortOrder: number;
}

/** One prior claim against a schedule item, from an invoice that still counts. */
export interface PriorClaim {
  sourceLineId: string;
  lineTotal: number;
}

export interface ClaimPosition {
  line: ScheduleLine;
  /** Ex-VAT value already claimed on earlier invoices. */
  previouslyClaimed: number;
  /** previouslyClaimed as a share of the item's contract value, 0–100+. */
  previouslyClaimedPct: number;
  /** Contract value not yet claimed. Never negative. */
  remaining: number;
}

export interface ClaimInput {
  sourceLineId: string;
  /** Completeness of this item TO DATE, 0–100. */
  cumulativePct: number;
}

export interface ClaimLine {
  sourceLineId: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  taxable: boolean;
  sortOrder: number;
  cumulativePct: number;
  cumulativeValue: number;
  previouslyClaimed: number;
  /** cumulativeValue − previouslyClaimed. The amount this invoice bills. */
  lineTotal: number;
}

export interface BuiltClaim {
  lines: ClaimLine[];
  /** Ex-VAT total of this claim. */
  subtotal: number;
  /** Lines whose cumulative % went backwards — see buildClaim(). */
  reversals: ClaimLine[];
}

/**
 * How much has already been claimed against each schedule item.
 *
 * Callers must pass only lines from invoices that still count — issued and not
 * voided. A voided invoice claimed nothing, and counting it would permanently
 * suppress the value it was supposed to bill.
 */
export function previouslyClaimedBySourceLine(priors: PriorClaim[]): Map<string, number> {
  const byLine = new Map<string, number[]>();
  for (const p of priors) {
    const list = byLine.get(p.sourceLineId) ?? [];
    list.push(toCents(p.lineTotal));
    byLine.set(p.sourceLineId, list);
  }
  return new Map([...byLine].map(([id, cents]) => [id, kes(sumCents(cents))]));
}

/** The claim position of every schedule item: worth, claimed, remaining. */
export function claimPositions(schedule: ScheduleLine[], priors: PriorClaim[]): ClaimPosition[] {
  const claimed = previouslyClaimedBySourceLine(priors);
  return schedule
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((line) => {
      const totalCents = toCents(line.lineTotal);
      const claimedCents = toCents(claimed.get(line.id) ?? 0);
      return {
        line,
        previouslyClaimed: kes(claimedCents),
        previouslyClaimedPct:
          totalCents > 0 ? Math.round((claimedCents / totalCents) * 1000) / 10 : 0,
        // An over-claim (from a later downward revision) must not show as
        // negative headroom; there is simply nothing left to claim.
        remaining: kes(Math.max(0, totalCents - claimedCents)),
      };
    });
}

export class ClaimError extends Error {}

/**
 * Turn cumulative percentages into the lines of one claim.
 *
 * A percentage below what has already been claimed produces a NEGATIVE line —
 * a genuine credit, and the correct output when last month over-stated the
 * work. Those lines are returned separately as `reversals` so a caller can
 * make the user confirm rather than quietly issuing a credit note they did not
 * mean to raise. Lines with nothing to bill are dropped: a claim padded with
 * zero rows is harder to check, not more complete.
 */
export function buildClaim(
  schedule: ScheduleLine[],
  priors: PriorClaim[],
  inputs: ClaimInput[],
): BuiltClaim {
  const byId = new Map(schedule.map((l) => [l.id, l]));
  const claimed = previouslyClaimedBySourceLine(priors);

  const lines: ClaimLine[] = [];
  for (const input of inputs) {
    const line = byId.get(input.sourceLineId);
    if (!line) {
      throw new ClaimError(`Schedule item ${input.sourceLineId} is not on this contract`);
    }
    if (
      !Number.isFinite(input.cumulativePct) ||
      input.cumulativePct < 0 ||
      input.cumulativePct > 100
    ) {
      throw new ClaimError(
        `${line.description}: completion to date must be between 0 and 100 percent`,
      );
    }

    const totalCents = toCents(line.lineTotal);
    const cumulativeCents = pctOfCents(totalCents, input.cumulativePct);
    const previousCents = toCents(claimed.get(line.id) ?? 0);
    const thisClaimCents = cumulativeCents - previousCents;
    if (thisClaimCents === 0) continue;

    lines.push({
      sourceLineId: line.id,
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      unitPrice: line.unitPrice,
      taxable: line.taxable,
      sortOrder: line.sortOrder,
      cumulativePct: input.cumulativePct,
      cumulativeValue: kes(cumulativeCents),
      previouslyClaimed: kes(previousCents),
      lineTotal: kes(thisClaimCents),
    });
  }

  lines.sort((a, b) => a.sortOrder - b.sortOrder);
  const subtotal = kes(sumCents(lines.map((l) => toCents(l.lineTotal))));
  return { lines, subtotal, reversals: lines.filter((l) => l.lineTotal < 0) };
}
