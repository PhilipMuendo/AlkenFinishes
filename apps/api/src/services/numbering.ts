import type { Prisma } from '@prisma/client';
import { env } from '../config/env';

/** Document series that draw from a year-scoped counter. */
export type SeriesKind = 'INVOICE' | 'RECEIPT' | 'QUOTATION' | 'CONTRACT' | 'PROJECT';

/**
 * The year a document number belongs to, in APP_TIMEZONE.
 *
 * Using UTC would file an invoice issued 31 Dec at 22:00 EAT under the
 * following year, which is exactly the kind of thing an auditor notices.
 */
export function seriesYear(d: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-CA', { timeZone: env.APP_TIMEZONE, year: 'numeric' }).format(d),
  );
}

/**
 * Allocates the next number in a year-scoped series, e.g. ALK-2026-000245.
 *
 * Deliberately a counter row rather than a native Postgres sequence:
 * `nextval()` is non-transactional by design, so a rollback would burn the
 * number permanently — the opposite of what a document series needs. Year
 * scoping would also force either runtime DDL or a racy January reset.
 * Sequences exist to avoid contention at thousands of TPS; this system issues
 * tens of documents a month.
 *
 * `UPDATE ... RETURNING` takes a row-level lock held until commit, so
 * concurrent issuers serialise on the one row and each gets a distinct
 * number, while a rollback returns the number to the pool.
 *
 * Contract for callers:
 *  - MUST be called inside the same interactive transaction that persists the
 *    row using the number.
 *  - SHOULD be the first statement in that transaction. Consistent lock
 *    ordering means the invoice and receipt series can never deadlock against
 *    each other.
 *  - The transaction must stay short. Never render a PDF inside it: that holds
 *    this lock across a slow operation and pushes concurrent callers into
 *    Prisma's interactive-transaction timeout.
 */
export async function nextNumber(
  tx: Prisma.TransactionClient,
  kind: SeriesKind,
  opts: { prefix: string; year: number; pad?: number },
): Promise<string> {
  const scope = `${kind}:${opts.year}`;

  // Create-if-missing without racing two concurrent first-of-the-year
  // issuers: ON CONFLICT DO NOTHING, after which the UPDATE below is
  // guaranteed to find (and lock) exactly one row.
  await tx.$executeRaw`
    INSERT INTO "NumberSequence" ("scope", "next", "updatedAt")
    VALUES (${scope}, 1, now())
    ON CONFLICT ("scope") DO NOTHING`;

  const rows = await tx.$queryRaw<{ n: number }[]>`
    UPDATE "NumberSequence"
       SET "next" = "next" + 1, "updatedAt" = now()
     WHERE "scope" = ${scope}
    RETURNING "next" - 1 AS "n"`;

  return format(opts.prefix, opts.year, rows[0].n, opts.pad);
}

/** Renders a series number without consuming one — for "next number" previews. */
export function format(prefix: string, year: number, n: number, pad = 6): string {
  return `${prefix}-${year}-${String(n).padStart(pad, '0')}`;
}

/**
 * The number the next document in a series *would* get, without allocating
 * it. Display only — two callers can read the same value.
 */
export async function peekNextNumber(
  db: Prisma.TransactionClient,
  kind: SeriesKind,
  opts: { prefix: string; year: number; pad?: number },
): Promise<string> {
  const row = await db.numberSequence.findUnique({ where: { scope: `${kind}:${opts.year}` } });
  return format(opts.prefix, opts.year, row?.next ?? 1, opts.pad);
}
