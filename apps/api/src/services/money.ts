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

// ---- Amount in words ----

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const SCALES: [number, string][] = [
  [1_000_000_000, 'Billion'],
  [1_000_000, 'Million'],
  [1_000, 'Thousand'],
];

function underThousand(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) {
    const tens = TENS[Math.floor(n / 10)];
    const ones = ONES[n % 10];
    return ones ? `${tens} ${ones}` : tens;
  }
  const hundreds = `${ONES[Math.floor(n / 100)]} Hundred`;
  const rest = n % 100;
  return rest ? `${hundreds} and ${underThousand(rest)}` : hundreds;
}

function wholeInWords(n: number): string {
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  let left = n;
  for (const [value, name] of SCALES) {
    if (left >= value) {
      parts.push(`${wholeInWords(Math.floor(left / value))} ${name}`);
      left %= value;
    }
  }
  if (left > 0) parts.push(underThousand(left));
  return parts.join(' ');
}

/**
 * Integer cents -> the sum written out in words, as a contract requires.
 *
 * Kenyan contract practice is that the words govern where words and figures
 * disagree, which is exactly why this is generated from the same cents value
 * the figures are printed from rather than typed in by hand.
 *
 * No currency lead-in, so the caller can choose one; ends in "Only", which is
 * the convention.
 */
export function amountInWords(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const shillings = Math.floor(abs / 100);
  const remainder = abs % 100;
  const words = [
    wholeInWords(shillings),
    shillings === 1 ? 'Shilling' : 'Shillings',
    ...(remainder > 0 ? ['and', underThousand(remainder), remainder === 1 ? 'Cent' : 'Cents'] : []),
    'Only',
  ].join(' ');
  return negative ? `Minus ${words}` : words;
}
