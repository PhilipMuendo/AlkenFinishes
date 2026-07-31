import { Prisma } from '@prisma/client';

/**
 * Money is handled as integer minor units (cents) everywhere between reading
 * from the database and writing back to it.
 *
 * Why not plain numbers: `0.1 + 0.2 !== 0.3`, and an invoice that is one cent
 * off is an invoice a client can reject.
 *
 * Why not raw Decimal chains: Decimal is exact, but every operation needs an
 * explicit rounding mode, and a stray Decimal serialises to a *string* in JSON.
 * Cents are exact, cheap, trivially unit-testable, and force the rounding
 * points to be written down explicitly.
 *
 * The rule: `toCents()` on the way in, arithmetic in cents, `fromCents()` to
 * persist, `kes()` to serialise.
 */
export type MoneyLike = Prisma.Decimal | number | string | null | undefined;

/** Any money-ish value -> integer cents, half-up at 2dp. */
export function toCents(v: MoneyLike): number {
  if (v == null) return 0;
  return new Prisma.Decimal(v)
    .times(100)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
    .toNumber();
}

/** Integer cents -> Decimal, for writing into a Decimal(14,2) column. */
export function fromCents(cents: number): Prisma.Decimal {
  return new Prisma.Decimal(cents).dividedBy(100);
}

/**
 * Integer cents -> plain KES number, for JSON responses only.
 *
 * Safe because a Decimal(14,2) column tops out at 999,999,999,999.99, i.e.
 * ~1e14 cents, comfortably inside 2^53. What is *not* safe is calling this
 * before arithmetic, or on an intermediate that has not been rounded yet.
 */
export function kes(cents: number): number {
  return cents / 100;
}

/** round(baseCents * ratePct / 100), half-up, staying in integer cents. */
export function pctOfCents(baseCents: number, ratePct: MoneyLike): number {
  if (!ratePct) return 0;
  return new Prisma.Decimal(baseCents)
    .times(new Prisma.Decimal(ratePct))
    .dividedBy(100)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
    .toNumber();
}

/** round(quantity * unitPrice) in cents, half-up. */
export function lineTotalCents(quantity: MoneyLike, unitPrice: MoneyLike): number {
  return new Prisma.Decimal(quantity ?? 0)
    .times(new Prisma.Decimal(unitPrice ?? 0))
    .times(100)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
    .toNumber();
}

export const sumCents = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
