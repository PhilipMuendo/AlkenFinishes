import crypto from 'crypto';

/**
 * A one-time or expiring link handed to someone who is not a `User` of this
 * system — a client signing a contract, a client deciding on a quotation, a
 * supplier checking their own statement. Each of those keeps its own table
 * (`ContractSigningLink`, `QuotationDecisionLink`, `SupplierStatementLink`)
 * rather than one polymorphic one, so the foreign key to what the link is
 * for stays a real, checked reference — but the token mechanics underneath
 * are identical, and live here once so the three can't quietly drift.
 *
 * The plaintext token is never stored, only `hashToken(token)` — a leaked
 * database is not enough to sign or decide anything.
 */

export function generateToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Whether a link row is still good to use. `usedAt` is passed through as an
 * argument (not read here) because not every link type is single-use — a
 * supplier statement link stays valid across repeat visits until it expires
 * or is revoked, so its caller simply never sets `usedAt` in the first place
 * and always passes `null`.
 */
export function isLinkUsable(link: {
  usedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
}): boolean {
  return !link.revokedAt && !link.usedAt && link.expiresAt.getTime() > Date.now();
}

/** A raw token from a URL param — reject anything absurd before it ever reaches a hash/lookup. */
export function looksLikeToken(token: unknown): token is string {
  return typeof token === 'string' && token.length > 0 && token.length <= 128;
}
