import { kes, toCents } from './money';

/**
 * Reading a supplier receipt.
 *
 * THE MODEL SUGGESTS. IT NEVER WRITES TO THE BOOKS.
 *
 * Everything here produces a DRAFT that prefills a form a human confirms.
 * That is not caution for its own sake: every money figure in this system
 * reconciles against something else — a claim against a schedule, a payment
 * against a bill, input VAT against a return — and a figure nobody checked
 * would poison all of it silently. A misread 8 for a 3 in a VAT column is not
 * a typo, it is a wrong return.
 *
 * The valuable half of this file is not the extraction, it is `verify()`. A
 * model can misread a digit; it cannot make the arithmetic agree. Checking
 * that subtotal + VAT equals the printed total, and that the VAT matches the
 * rate, catches exactly the errors that matter and costs nothing. What the
 * user is shown is never "the AI says 16,000" but "the AI says 16,000 and the
 * arithmetic agrees", or else "…and it does not — look at this one".
 */

export interface ExtractedReceipt {
  supplierName: string | null;
  /** The supplier's KRA PIN if printed. Used to match, never to create. */
  supplierPin: string | null;
  invoiceNo: string | null;
  /** ISO date, or null when nothing legible was found. */
  date: string | null;
  /** Ex-VAT value of the supply. */
  subtotal: number | null;
  vatAmount: number | null;
  /** The figure the receipt asks you to pay. */
  total: number | null;
  /** Whether it looks like a proper tax invoice (ETR), which VAT recovery needs. */
  taxInvoice: boolean;
  /** The model's own note about anything illegible or unusual. */
  note: string | null;
}

export type CheckStatus = 'OK' | 'WARN' | 'UNKNOWN';

export interface Check {
  id: string;
  status: CheckStatus;
  message: string;
}

export interface VerifiedReceipt {
  extracted: ExtractedReceipt;
  checks: Check[];
  /** True when anything failed or could not be checked at all. */
  needsReview: boolean;
  /** What to put in the form: gross, and the VAT within it. */
  suggested: { amount: number | null; vatAmount: number | null; vatRatePct: number | null };
}

/** Receipts round to the shilling as often as to the cent. */
const TOLERANCE_CENTS = 100;

const near = (a: number, b: number, tolerance = TOLERANCE_CENTS) => Math.abs(a - b) <= tolerance;

/**
 * Check the extraction against itself and against the expected VAT rate.
 *
 * Deliberately pure and free of any model: this is what makes an extracted
 * figure safe to show, and it must be testable without a network call.
 */
export function verify(
  extracted: ExtractedReceipt,
  expectedVatRatePct: number,
  asOf: Date = new Date(),
): VerifiedReceipt {
  const checks: Check[] = [];
  const { subtotal, vatAmount, total } = extracted;

  const subCents = subtotal == null ? null : toCents(subtotal);
  const vatCents = vatAmount == null ? null : toCents(vatAmount);
  const totalCents = total == null ? null : toCents(total);

  // 1. The receipt must add up. A model can misread a digit; it cannot make
  //    the arithmetic agree, so this catches the errors that matter.
  if (subCents != null && vatCents != null && totalCents != null) {
    const adds = near(subCents + vatCents, totalCents);
    checks.push({
      id: 'adds-up',
      status: adds ? 'OK' : 'WARN',
      message: adds
        ? 'Subtotal plus VAT equals the total'
        : `Subtotal plus VAT comes to ${kes(subCents + vatCents)}, but the total reads ${kes(totalCents)}`,
    });
  } else {
    checks.push({
      id: 'adds-up',
      status: 'UNKNOWN',
      message: 'Not every figure was legible, so the arithmetic could not be checked',
    });
  }

  // 2. The VAT should match the rate on the ex-VAT value.
  if (subCents != null && vatCents != null && expectedVatRatePct > 0) {
    const expected = Math.round((subCents * expectedVatRatePct) / 100);
    // Proportional tolerance on top of the flat one: a large bill rounds by
    // more shillings than a small one without anything being wrong.
    const slack = Math.max(TOLERANCE_CENTS, Math.round(subCents * 0.005));
    const ok = near(vatCents, expected, slack);
    checks.push({
      id: 'vat-rate',
      status: ok ? 'OK' : 'WARN',
      message: ok
        ? `VAT is ${expectedVatRatePct}% of the value, as expected`
        : `VAT of ${kes(vatCents)} is not ${expectedVatRatePct}% of ${kes(subCents)} — that would be ${kes(expected)}`,
    });
  } else if (vatCents === 0 || vatCents == null) {
    checks.push({
      id: 'vat-rate',
      status: 'UNKNOWN',
      message: 'No VAT was read. Zero-rated and exempt supplies are normal — check the receipt.',
    });
  }

  // 3. A total that is nil or negative is not a purchase.
  if (totalCents != null && totalCents <= 0) {
    checks.push({
      id: 'total',
      status: 'WARN',
      message: 'The total reads as zero or less, which is not a purchase',
    });
  }

  // 4. A future date is a misread year far more often than a real one.
  if (extracted.date) {
    const d = new Date(extracted.date);
    if (Number.isNaN(d.getTime())) {
      checks.push({ id: 'date', status: 'WARN', message: 'The date could not be read' });
    } else if (d.getTime() > asOf.getTime() + 86_400_000) {
      checks.push({
        id: 'date',
        status: 'WARN',
        message: `The date reads ${extracted.date}, which is in the future`,
      });
    }
  } else {
    checks.push({ id: 'date', status: 'UNKNOWN', message: 'No date was legible' });
  }

  // 5. Input VAT is only recoverable against a proper tax invoice.
  if (!extracted.taxInvoice && (vatCents ?? 0) > 0) {
    checks.push({
      id: 'tax-invoice',
      status: 'WARN',
      message:
        'VAT is charged but this does not look like a tax invoice (ETR). Without one the VAT is a cost, not a credit.',
    });
  }

  return {
    extracted,
    checks,
    needsReview: checks.some((c) => c.status !== 'OK'),
    suggested: suggestFigures(extracted, expectedVatRatePct),
  };
}

/**
 * What to put in the form.
 *
 * `amount` is GROSS, matching how a supplier bill is stored — what we owe
 * them. Where the receipt gives enough to be sure, the VAT comes across too;
 * where it does not, VAT is left null rather than guessed, because a guessed
 * VAT figure flows straight into a return.
 */
export function suggestFigures(
  extracted: ExtractedReceipt,
  expectedVatRatePct: number,
): VerifiedReceipt['suggested'] {
  const { subtotal, vatAmount, total } = extracted;

  // Best case: the receipt printed all three and they agree.
  if (subtotal != null && vatAmount != null) {
    const gross = total ?? kes(toCents(subtotal) + toCents(vatAmount));
    const rate =
      toCents(subtotal) > 0
        ? Math.round((toCents(vatAmount) / toCents(subtotal)) * 1000) / 10
        : 0;
    return { amount: gross, vatAmount, vatRatePct: rate };
  }

  // Total and VAT, no subtotal: the subtotal is implied, so this is safe.
  if (total != null && vatAmount != null) {
    const netCents = toCents(total) - toCents(vatAmount);
    const rate = netCents > 0 ? Math.round((toCents(vatAmount) / netCents) * 1000) / 10 : 0;
    return { amount: total, vatAmount, vatRatePct: rate };
  }

  // Only a total. Do NOT infer VAT: a receipt with no VAT line may well be
  // from a supplier who is not registered, and inventing 16% would claim a
  // credit that does not exist.
  if (total != null) {
    return { amount: total, vatAmount: null, vatRatePct: null };
  }

  return { amount: null, vatAmount: null, vatRatePct: null };
}

// ---- The model call ----

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Which service reads the receipts.
 *
 * Pluggable on purpose. Reading a receipt is high volume and low risk — the
 * verification below catches a misread whichever model produced it — so this
 * is exactly the job to run on the cheapest model that does it well, and the
 * cheapest model changes. Swapping providers must not mean a code change, and
 * must not touch a line of the checking that makes the output safe.
 */
export type ReceiptProvider = 'gemini' | 'anthropic';

export function receiptProvider(): ReceiptProvider | null {
  const explicit = process.env.RECEIPT_PROVIDER?.toLowerCase();
  if (explicit === 'gemini') return process.env.GEMINI_API_KEY ? 'gemini' : null;
  if (explicit === 'anthropic') return process.env.ANTHROPIC_API_KEY ? 'anthropic' : null;
  // No explicit choice: use whichever key is present, cheapest first.
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return null;
}

/** Absent key means the feature is simply off; the form still works by hand. */
export function receiptScanningAvailable(): boolean {
  return receiptProvider() !== null;
}

/**
 * Why a scan failed, when the caller needs to do more than show the message.
 *
 * `QUOTA_DAILY` is the one that matters on a free key: there is no point
 * offering the button again until tomorrow, and no point the user trying.
 */
export type ExtractionFailure =
  | 'NOT_CONFIGURED'
  | 'RATE_LIMIT'
  | 'QUOTA_DAILY'
  | 'AUTH'
  | 'TOO_LARGE'
  | 'TIMEOUT'
  | 'UNREADABLE'
  | 'UPSTREAM';

export class ExtractionError extends Error {
  constructor(
    message: string,
    readonly reason: ExtractionFailure = 'UPSTREAM',
    /** Seconds to wait, when the service told us. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

/**
 * Read a Google quota rejection.
 *
 * A free key rejects for two very different reasons and the difference is the
 * whole message: a per-minute burst clears in under a minute, while the daily
 * cap means there is nothing more today. Telling someone to "try again
 * shortly" when their allowance is gone until midnight wastes their afternoon.
 */
export function readGeminiQuota(body: unknown): {
  reason: 'RATE_LIMIT' | 'QUOTA_DAILY';
  retryAfterSeconds?: number;
} {
  const details =
    (body as { error?: { details?: { '@type'?: string; [k: string]: unknown }[] } })?.error
      ?.details ?? [];

  let retryAfterSeconds: number | undefined;
  let daily = false;

  for (const d of details) {
    const type = String(d['@type'] ?? '');
    if (type.endsWith('RetryInfo')) {
      const raw = String((d as { retryDelay?: unknown }).retryDelay ?? '');
      const secs = parseFloat(raw.replace(/s$/, ''));
      if (Number.isFinite(secs)) retryAfterSeconds = Math.ceil(secs);
    }
    if (type.endsWith('QuotaFailure')) {
      const violations = ((d as { violations?: { quotaId?: string }[] }).violations ?? []) as {
        quotaId?: string;
      }[];
      if (violations.some((v) => /perday/i.test(v.quotaId ?? ''))) daily = true;
    }
  }

  // A retry measured in hours is a daily cap however it was labelled.
  if (retryAfterSeconds != null && retryAfterSeconds > 3600) daily = true;

  return daily ? { reason: 'QUOTA_DAILY' } : { reason: 'RATE_LIMIT', retryAfterSeconds };
}

const DEFAULT_MODEL: Record<ReceiptProvider, string> = {
  gemini: 'gemini-2.5-flash',
  anthropic: 'claude-sonnet-5',
};

const SYSTEM_PROMPT = `You read supplier receipts and tax invoices for a Kenyan construction company and return only what is printed on them.

Return ONLY a JSON object, no prose, with exactly these keys:
{
  "supplierName": string|null,
  "supplierPin": string|null,
  "invoiceNo": string|null,
  "date": string|null,
  "subtotal": number|null,
  "vatAmount": number|null,
  "total": number|null,
  "taxInvoice": boolean,
  "note": string|null
}

Rules:
- Report ONLY figures actually printed. If a figure is missing or illegible, use null. NEVER calculate a missing figure - a downstream check does that, and a calculated figure hides a misread one.
- Numbers must be plain, without currency symbols or thousands separators. 1,234.50 becomes 1234.5
- "date" is the invoice or receipt date in YYYY-MM-DD. Use null if you cannot read it.
- "subtotal" is the value BEFORE VAT. "total" is the amount payable. "vatAmount" is the VAT line only.
- "taxInvoice" is true only if this is a proper tax invoice - an ETR receipt, a printed PIN, or the words "TAX INVOICE". A plain till slip or delivery note is false.
- "note" is one short sentence about anything smudged, ambiguous or unusual, else null.
- If the image is not a receipt or invoice at all, set every field null and say so in "note".`;

const USER_PROMPT = 'Read this receipt and return the JSON object.';

export interface ScanOptions {
  model?: string;
  timeoutMs?: number;
  provider?: ReceiptProvider;
}

/**
 * Base64 inflates a file by a third, and both APIs cap the request. Refusing
 * here gives the user something they can act on instead of a provider error
 * they cannot read.
 */
const MAX_INLINE_BYTES = 6 * 1024 * 1024;

async function post(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    const timedOut = (e as Error).name === 'AbortError';
    throw new ExtractionError(
      timedOut
        ? 'Reading the receipt took too long. Enter it by hand.'
        : 'Could not reach the reading service. Enter it by hand.',
      timedOut ? 'TIMEOUT' : 'UPSTREAM',
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Turn an upstream rejection into something the user can act on.
 *
 * The body is read for quota detail but never passed through: it can carry
 * project and account identifiers that are nobody's business on a site phone.
 */
function failed(status: number, body?: unknown): never {
  if (status === 401 || status === 403) {
    throw new ExtractionError(
      'The receipt-reading key was rejected. Check it in the server configuration.',
      'AUTH',
    );
  }
  if (status === 429) {
    const { reason, retryAfterSeconds } = readGeminiQuota(body);
    if (reason === 'QUOTA_DAILY') {
      throw new ExtractionError(
        "You have used up today's free receipt reading. It resets tomorrow — enter this one by hand.",
        'QUOTA_DAILY',
      );
    }
    throw new ExtractionError(
      retryAfterSeconds
        ? `Too many receipts at once. Try again in about ${retryAfterSeconds} second${retryAfterSeconds === 1 ? '' : 's'}, or enter this one by hand.`
        : 'Too many receipts at once. Wait a moment and try again, or enter this one by hand.',
      'RATE_LIMIT',
      retryAfterSeconds,
    );
  }
  throw new ExtractionError(
    `The receipt could not be read (${status}). Enter it by hand.`,
    'UPSTREAM',
  );
}

async function callGemini(
  image: Buffer,
  mediaType: string,
  model: string,
  timeoutMs: number,
): Promise<string> {
  const key = process.env.GEMINI_API_KEY!;
  const res = await post(
    `${GEMINI_URL}/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [
          {
            role: 'user',
            parts: [
              { inline_data: { mime_type: mediaType, data: image.toString('base64') } },
              { text: USER_PROMPT },
            ],
          },
        ],
        generationConfig: {
          // Ask for JSON directly rather than hoping for it. parseExtraction
          // still tolerates a fence, because a refusal can arrive as prose.
          responseMimeType: 'application/json',
          temperature: 0,
          maxOutputTokens: 1024,
        },
      }),
    },
    timeoutMs,
  );
  if (!res.ok) failed(res.status, await res.json().catch(() => undefined));

  const body = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  return (body.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? '')
    .join('')
    .trim();
}

async function callAnthropic(
  image: Buffer,
  mediaType: string,
  model: string,
  timeoutMs: number,
): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY!;
  const isPdf = mediaType === 'application/pdf';
  const res = await post(
    ANTHROPIC_URL,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: isPdf ? 'document' : 'image',
                source: { type: 'base64', media_type: mediaType, data: image.toString('base64') },
              },
              { type: 'text', text: USER_PROMPT },
            ],
          },
        ],
      }),
    },
    timeoutMs,
  );
  if (!res.ok) failed(res.status, await res.json().catch(() => undefined));

  const body = (await res.json()) as { content?: { type: string; text?: string }[] };
  return (body.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('')
    .trim();
}

/**
 * Ask the configured service to read one receipt.
 *
 * Kept deliberately thin: it returns raw claims which `verify()` then checks.
 * Nothing here decides anything, and nothing it returns reaches the database
 * without a human pressing save. That is also what makes the choice of model
 * a safe, reversible one — a cheaper model that misreads is caught by the
 * arithmetic, not silently believed.
 */
export async function scanReceipt(
  image: Buffer,
  mediaType: string,
  opts: ScanOptions = {},
): Promise<ExtractedReceipt> {
  const provider = opts.provider ?? receiptProvider();
  if (!provider) throw new ExtractionError('Receipt scanning is not configured', 'NOT_CONFIGURED');
  if (image.byteLength > MAX_INLINE_BYTES) {
    throw new ExtractionError(
      'That file is too large to read. Photograph the receipt instead of attaching a scan.',
      'TOO_LARGE',
    );
  }

  const model = opts.model ?? process.env.RECEIPT_MODEL ?? DEFAULT_MODEL[provider];
  const timeoutMs = opts.timeoutMs ?? 45_000;
  const text =
    provider === 'gemini'
      ? await callGemini(image, mediaType, model, timeoutMs)
      : await callAnthropic(image, mediaType, model, timeoutMs);

  return parseExtraction(text);
}

/**
 * Parse the model's reply.
 *
 * Every field is coerced and range-checked here rather than trusted: this is a
 * parser for untrusted input, not a deserialiser. A string where a number
 * belongs, or a stray fence around the JSON, must not reach the caller.
 */
export function parseExtraction(text: string): ExtractedReceipt {
  // Tolerate a ```json fence or a sentence around the object.
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new ExtractionError('The receipt could not be read. Enter it by hand.', 'UNREADABLE');
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    throw new ExtractionError('The receipt could not be read. Enter it by hand.', 'UNREADABLE');
  }

  const str = (v: unknown): string | null => {
    if (typeof v !== 'string') return null;
    const t = v.trim();
    return t === '' || t.toLowerCase() === 'null' ? null : t.slice(0, 200);
  };
  const money = (v: unknown): number | null => {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v.replace(/,/g, '')) : NaN;
    // A receipt in the hundreds of millions is a misread, not a purchase.
    if (!Number.isFinite(n) || n < 0 || n > 1_000_000_000) return null;
    return Math.round(n * 100) / 100;
  };
  const date = (v: unknown): string | null => {
    const s = str(v);
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    return Number.isNaN(new Date(s).getTime()) ? null : s;
  };

  return {
    supplierName: str(raw.supplierName),
    supplierPin: str(raw.supplierPin),
    invoiceNo: str(raw.invoiceNo),
    date: date(raw.date),
    subtotal: money(raw.subtotal),
    vatAmount: money(raw.vatAmount),
    total: money(raw.total),
    taxInvoice: raw.taxInvoice === true,
    note: str(raw.note),
  };
}

/**
 * Match an extracted supplier name to one already on the list.
 *
 * EXACT, case- and punctuation-insensitive only. No fuzzy matching: attaching
 * a bill to the wrong supplier misstates what two different merchants are
 * owed, and "Bamburi" against "Bamburi Cement" is a guess, not a match. An
 * unmatched name is offered to the user to confirm or add.
 */
export function matchSupplier<T extends { id: string; name: string }>(
  extractedName: string | null,
  suppliers: T[],
): T | null {
  if (!extractedName) return null;
  const normalise = (s: string) =>
    s
      .toLowerCase()
      .replace(/\b(ltd|limited|co|company|enterprises|hardware|suppliers?)\b/g, '')
      .replace(/[^a-z0-9]/g, '')
      .trim();
  const target = normalise(extractedName);
  if (!target) return null;
  return suppliers.find((s) => normalise(s.name) === target) ?? null;
}
