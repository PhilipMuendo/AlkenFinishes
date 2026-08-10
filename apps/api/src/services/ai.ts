/**
 * The one place this system talks to a language model.
 *
 * Provider selection, transport, timeouts and quota handling live here so
 * every feature that uses a model gets the same behaviour — in particular the
 * same clear message when a free allowance runs out, which is otherwise the
 * kind of thing that gets handled well once and badly everywhere else.
 *
 * What this file deliberately does NOT do is decide anything. It returns text.
 * Every caller is responsible for treating that text as an untrusted claim and
 * checking it before a figure reaches the database.
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Which service is used.
 *
 * Pluggable on purpose. These are high volume, low risk jobs — every caller
 * checks the output — so they belong on the cheapest model that does them
 * well, and the cheapest model changes. Swapping must be configuration, never
 * a code change.
 */
export type AiProvider = 'gemini' | 'anthropic';

/**
 * An unset docker-compose variable arrives as an empty string, not as absent,
 * so `??` never falls through to a default and `""` wins. This file reads
 * process.env directly rather than the parsed config — it is deliberately free
 * of imports so it stays testable without a database — which means it has to
 * do that normalisation itself. Getting this wrong sent every request to
 * `/models/:generateContent` with no model in it, which Google answers 404.
 */
const blank = (v: string | undefined): string | undefined => {
  const t = v?.trim();
  return t ? t : undefined;
};

export function aiProvider(): AiProvider | null {
  const explicit = blank(process.env.RECEIPT_PROVIDER)?.toLowerCase();
  // A key of spaces is a key nobody set. Treated as absent, the feature is
  // simply not offered; treated as present, every button fails on use.
  const gemini = blank(process.env.GEMINI_API_KEY);
  const anthropic = blank(process.env.ANTHROPIC_API_KEY);
  if (explicit === 'gemini') return gemini ? 'gemini' : null;
  if (explicit === 'anthropic') return anthropic ? 'anthropic' : null;
  // No explicit choice: use whichever key is present, cheapest first.
  if (gemini) return 'gemini';
  if (anthropic) return 'anthropic';
  return null;
}

/** No key means every AI feature is simply absent and the forms work by hand. */
export function aiAvailable(): boolean {
  return aiProvider() !== null;
}

/**
 * Pinned, not aliased ("gemini-flash-latest"), so a model does not change
 * underneath a receipt scanner without anyone deciding it should.
 *
 * The cost of pinning is that a retired model breaks every feature at once:
 * Google keeps a withdrawn model in ListModels but answers `generateContent`
 * with 404, so it fails at the moment of use rather than at start-up. That is
 * what RECEIPT_MODEL is for — the fix is a line of configuration and a
 * restart, and `failed()` below says so when it happens.
 *
 * The lite model is the default rather than plain flash, and the reason is
 * the free tier: flash allows 20 requests A DAY, which at two calls per
 * question is ten questions for the whole company, shared with the receipt
 * reader. Lite's allowance is far larger, it reads a receipt photograph just
 * as well, and it is roughly twice as fast. None of these jobs reward a
 * stronger model — every one of them is extraction or summary over facts
 * that have already been assembled, and every caller checks the output.
 * An office on a paid key can set RECEIPT_MODEL to something heavier.
 */
const DEFAULT_MODEL: Record<AiProvider, string> = {
  gemini: 'gemini-3.5-flash-lite',
  anthropic: 'claude-sonnet-5',
};

/**
 * Why a call failed, when the caller needs to do more than show the message.
 *
 * `QUOTA_DAILY` is the one that matters on a free key: there is no point
 * offering the button again until tomorrow, and no point the user trying.
 */
export type AiFailure =
  | 'NOT_CONFIGURED'
  | 'RATE_LIMIT'
  | 'QUOTA_DAILY'
  | 'AUTH'
  | 'MODEL_UNAVAILABLE'
  | 'TOO_LARGE'
  | 'TIMEOUT'
  | 'UNREADABLE'
  | 'UPSTREAM';

export class AiError extends Error {
  constructor(
    message: string,
    readonly reason: AiFailure = 'UPSTREAM',
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

  // The quotaId is the only trustworthy signal, and specifically the retry
  // delay is NOT one. Observed live: a genuinely exhausted daily allowance
  // (GenerateRequestsPerDayPerProjectPerModel-FreeTier, limit 20) came back
  // with "retry in 39s", which is nonsense — the allowance was gone for the
  // day. Do not be tempted to read a short delay as a burst; it will tell
  // someone to try again in forty seconds, forever.
  return daily ? { reason: 'QUOTA_DAILY' } : { reason: 'RATE_LIMIT', retryAfterSeconds };
}

async function post(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    const timedOut = (e as Error).name === 'AbortError';
    throw new AiError(
      timedOut ? 'That took too long. Try again, or fill it in by hand.' : 'Could not reach the service. Fill it in by hand.',
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
function failed(status: number, body: unknown, noun: string): never {
  if (status === 401 || status === 403) {
    throw new AiError('The key was rejected. Check it in the server configuration.', 'AUTH');
  }
  if (status === 404) {
    // The model is gone, not the request. Google retires a model without
    // removing it from ListModels, so this arrives the first time somebody
    // presses the button and looks exactly like a broken feature. Nobody on
    // site can act on it, so say who can and what they change.
    throw new AiError(
      'The configured AI model is no longer available. Set RECEIPT_MODEL to a current model and restart the server.',
      'MODEL_UNAVAILABLE',
    );
  }
  if (status === 429) {
    const { reason, retryAfterSeconds } = readGeminiQuota(body);
    if (reason === 'QUOTA_DAILY') {
      throw new AiError(
        `You have used up today's free allowance. It resets tomorrow — write this ${noun} by hand.`,
        'QUOTA_DAILY',
      );
    }
    throw new AiError(
      retryAfterSeconds
        ? `Too many requests at once. Try again in about ${retryAfterSeconds} second${retryAfterSeconds === 1 ? '' : 's'}.`
        : 'Too many requests at once. Wait a moment and try again.',
      'RATE_LIMIT',
      retryAfterSeconds,
    );
  }
  throw new AiError(`That could not be done (${status}). Fill it in by hand.`, 'UPSTREAM');
}

/** An image or document sent alongside the prompt. */
export interface AiAttachment {
  data: Buffer;
  mediaType: string;
}

export interface GenerateOptions {
  system: string;
  user: string;
  attachment?: AiAttachment;
  /** Ask the provider for JSON directly where it supports it. */
  json?: boolean;
  maxTokens?: number;
  timeoutMs?: number;
  model?: string;
  /** What the user was trying to produce, for the "do it by hand" message. */
  noun?: string;
}

/**
 * Base64 inflates a file by a third, and both APIs cap the request. Refusing
 * here gives the user something they can act on instead of a provider error
 * they cannot read.
 */
const MAX_INLINE_BYTES = 6 * 1024 * 1024;

/**
 * Tokens allowed for reasoning, on top of whatever the caller asked for.
 * See the note in callGemini: without it a caller's answer budget is silently
 * shared with the model's thinking.
 */
const THINKING_HEADROOM = 512;

/** Ask the configured model for text. Returns exactly what it said. */
export async function generate(opts: GenerateOptions): Promise<string> {
  const provider = aiProvider();
  if (!provider) throw new AiError('This feature is not configured', 'NOT_CONFIGURED');
  if (opts.attachment && opts.attachment.data.byteLength > MAX_INLINE_BYTES) {
    throw new AiError(
      'That file is too large. Photograph it instead of attaching a scan.',
      'TOO_LARGE',
    );
  }

  const model = blank(opts.model) ?? blank(process.env.RECEIPT_MODEL) ?? DEFAULT_MODEL[provider];
  const timeoutMs = opts.timeoutMs ?? 45_000;
  const noun = opts.noun ?? 'one';

  return provider === 'gemini'
    ? callGemini(opts, model, timeoutMs, noun)
    : callAnthropic(opts, model, timeoutMs, noun);
}

async function callGemini(
  opts: GenerateOptions,
  model: string,
  timeoutMs: number,
  noun: string,
): Promise<string> {
  const parts: Record<string, unknown>[] = [];
  if (opts.attachment) {
    parts.push({
      inline_data: {
        mime_type: opts.attachment.mediaType,
        data: opts.attachment.data.toString('base64'),
      },
    });
  }
  parts.push({ text: opts.user });

  const res = await post(
    `${GEMINI_URL}/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY! },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: opts.system }] },
        contents: [{ role: 'user', parts }],
        generationConfig: {
          ...(opts.json ? { responseMimeType: 'application/json' } : {}),
          temperature: 0,
          maxOutputTokens: (opts.maxTokens ?? 1024) + THINKING_HEADROOM,
          // Current Gemini models reason before answering and charge that
          // reasoning to the same budget as the answer. Left alone, a caller
          // asking for 400 tokens can spend all 400 thinking and return an
          // empty string. Reasoning is capped low — reading a receipt and
          // summarising a day's records are not problems that reward it —
          // and given its own headroom so the caller's number keeps meaning
          // what it says: room for the answer.
          thinkingConfig: { thinkingLevel: 'low' },
        },
      }),
    },
    timeoutMs,
  );
  if (!res.ok) failed(res.status, await res.json().catch(() => undefined), noun);

  const body = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  };
  const candidate = body.candidates?.[0];
  const text = (candidate?.content?.parts ?? [])
    .map((part) => part.text ?? '')
    .join('')
    .trim();

  // An empty reply is never usable, and every caller reports it as its own
  // kind of failure — "the receipt could not be read" for a truncation that
  // had nothing to do with the receipt. Name the real reason here instead.
  if (!text) {
    throw new AiError(
      candidate?.finishReason === 'MAX_TOKENS'
        ? `That answer was too long to finish. Try a shorter question, or write the ${noun} by hand.`
        : `Nothing came back. Write the ${noun} by hand.`,
      candidate?.finishReason === 'MAX_TOKENS' ? 'TOO_LARGE' : 'UPSTREAM',
    );
  }
  return text;
}

async function callAnthropic(
  opts: GenerateOptions,
  model: string,
  timeoutMs: number,
  noun: string,
): Promise<string> {
  const content: Record<string, unknown>[] = [];
  if (opts.attachment) {
    content.push({
      type: opts.attachment.mediaType === 'application/pdf' ? 'document' : 'image',
      source: {
        type: 'base64',
        media_type: opts.attachment.mediaType,
        data: opts.attachment.data.toString('base64'),
      },
    });
  }
  content.push({ type: 'text', text: opts.user });

  const res = await post(
    ANTHROPIC_URL,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: opts.maxTokens ?? 1024,
        temperature: 0,
        system: opts.system,
        messages: [{ role: 'user', content }],
      }),
    },
    timeoutMs,
  );
  if (!res.ok) failed(res.status, await res.json().catch(() => undefined), noun);

  const body = (await res.json()) as { content?: { type: string; text?: string }[] };
  return (body.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('')
    .trim();
}
