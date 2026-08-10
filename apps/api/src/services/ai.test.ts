import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { AiError, generate, readGeminiQuota } from './ai';

/**
 * The transport, tested at its edges rather than its middle.
 *
 * Everything here is a failure that once reached a supervisor as advice they
 * could not act on. A retired model told them to "fill it in by hand" when
 * nothing they did by hand would ever fix it; a reply truncated by the
 * model's own reasoning was reported as an unreadable receipt.
 */

const KEY = 'test-key';
const realFetch = globalThis.fetch;

/** Capture the request and answer it, without going near the network. */
function stubFetch(reply: { status?: number; body: unknown }) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
    return {
      ok: (reply.status ?? 200) < 400,
      status: reply.status ?? 200,
      json: async () => reply.body,
    } as Response;
  }) as unknown as typeof fetch;
  return calls;
}

const ok = (text: string, finishReason = 'STOP') => ({
  candidates: [{ content: { parts: [{ text }] }, finishReason }],
});

describe('gemini transport', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.RECEIPT_PROVIDER;
    delete process.env.RECEIPT_MODEL;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.GEMINI_API_KEY;
  });

  test('returns what the model said', async () => {
    stubFetch({ body: ok('  Nairobi  ') });
    assert.equal(await generate({ system: 's', user: 'u' }), 'Nairobi');
  });

  test('the default model is one that still exists', async () => {
    const calls = stubFetch({ body: ok('x') });
    await generate({ system: 's', user: 'u' });
    // The retired model that broke every AI feature at once. Pinning is fine;
    // pinning to this one is not.
    assert.ok(!calls[0]!.url.includes('gemini-2.5-flash'), calls[0]!.url);
  });

  test('RECEIPT_MODEL overrides the default without a code change', async () => {
    process.env.RECEIPT_MODEL = 'gemini-9-flash';
    const calls = stubFetch({ body: ok('x') });
    await generate({ system: 's', user: 'u' });
    assert.ok(calls[0]!.url.includes('gemini-9-flash'), calls[0]!.url);
  });

  // docker-compose passes an unset variable as "", which `??` accepts as a
  // value. This sent every request to `/models/:generateContent` — no model at
  // all — and Google answered 404, so the whole feature looked switched off.
  for (const unset of ['', '   ']) {
    test(`an unset RECEIPT_MODEL (${JSON.stringify(unset)}) falls back to the default`, async () => {
      process.env.RECEIPT_MODEL = unset;
      const calls = stubFetch({ body: ok('x') });
      await generate({ system: 's', user: 'u' });
      assert.match(calls[0]!.url, /models\/gemini-[\w.-]+:generateContent$/, calls[0]!.url);
    });
  }

  test('an unset RECEIPT_PROVIDER does not defeat provider selection', async () => {
    process.env.RECEIPT_PROVIDER = '';
    const calls = stubFetch({ body: ok('x') });
    await generate({ system: 's', user: 'u' });
    assert.ok(calls[0]!.url.startsWith('https://generativelanguage.googleapis.com'));
  });

  test('a key of nothing but spaces counts as no key', async () => {
    process.env.GEMINI_API_KEY = '   ';
    const e = await generate({ system: 's', user: 'u' }).catch((err: unknown) => err);
    assert.ok(e instanceof AiError);
    assert.equal(e.reason, 'NOT_CONFIGURED');
  });

  test('reasoning gets its own budget, not the caller’s', async () => {
    const calls = stubFetch({ body: ok('x') });
    await generate({ system: 's', user: 'u', maxTokens: 400 });
    const cfg = calls[0]!.body.generationConfig as Record<string, unknown>;
    // A caller asking for 400 tokens of answer must not lose them to thinking.
    assert.ok((cfg.maxOutputTokens as number) > 400);
    assert.deepEqual(cfg.thinkingConfig, { thinkingLevel: 'low' });
  });

  test('a retired model is named as configuration, not as a failed request', async () => {
    stubFetch({
      status: 404,
      body: { error: { code: 404, message: 'This model is no longer available to new users.' } },
    });
    const e = await generate({ system: 's', user: 'u' }).catch((err: unknown) => err);
    assert.ok(e instanceof AiError);
    assert.equal(e.reason, 'MODEL_UNAVAILABLE');
    assert.match(e.message, /RECEIPT_MODEL/);
  });

  test('a rejected key is not reported as a retired model', async () => {
    stubFetch({ status: 403, body: { error: { code: 403 } } });
    const e = await generate({ system: 's', user: 'u' }).catch((err: unknown) => err);
    assert.ok(e instanceof AiError);
    assert.equal(e.reason, 'AUTH');
  });

  test('a reply truncated before it began says so', async () => {
    stubFetch({ body: ok('', 'MAX_TOKENS') });
    const e = await generate({ system: 's', user: 'u', noun: 'receipt' }).catch(
      (err: unknown) => err,
    );
    assert.ok(e instanceof AiError);
    assert.equal(e.reason, 'TOO_LARGE');
    // Not "the receipt could not be read" — the receipt was never the problem.
    assert.match(e.message, /too long/i);
  });

  test('an empty reply never reaches a caller as a valid answer', async () => {
    stubFetch({ body: { candidates: [] } });
    const e = await generate({ system: 's', user: 'u' }).catch((err: unknown) => err);
    assert.ok(e instanceof AiError);
    assert.equal(e.reason, 'UPSTREAM');
  });

  test('the upstream body is never passed through to the user', async () => {
    stubFetch({
      status: 404,
      body: { error: { message: 'project 12345 / account someone@example.com' } },
    });
    const e = (await generate({ system: 's', user: 'u' }).catch((err: unknown) => err)) as AiError;
    assert.ok(!e.message.includes('12345'));
    assert.ok(!e.message.includes('example.com'));
  });

  test('no key configured is its own reason, before any request', async () => {
    delete process.env.GEMINI_API_KEY;
    const e = await generate({ system: 's', user: 'u' }).catch((err: unknown) => err);
    assert.ok(e instanceof AiError);
    assert.equal(e.reason, 'NOT_CONFIGURED');
  });
});

describe('quota rejections', () => {
  test('a per-minute burst is not a spent day', () => {
    const r = readGeminiQuota({
      error: {
        details: [
          { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '21s' },
          {
            '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
            violations: [{ quotaId: 'GenerateRequestsPerMinutePerProject' }],
          },
        ],
      },
    });
    assert.deepEqual(r, { reason: 'RATE_LIMIT', retryAfterSeconds: 21 });
  });

  /**
   * The exact body a spent free-tier allowance returns, captured live.
   *
   * Note the retry delay: Google says "39 seconds" about an allowance that is
   * gone until midnight. The quotaId is the only thing telling the truth, and
   * a plausible-looking "a short delay means a burst" rule reading this as
   * RATE_LIMIT would invite the user to retry in forty seconds all afternoon.
   */
  test('a spent day is read from the quota id, not from the retry delay', () => {
    const r = readGeminiQuota({
      error: {
        code: 429,
        message: 'Quota exceeded for metric: …free_tier_requests, limit: 20',
        details: [
          { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '39.4s' },
          {
            '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
            violations: [
              { quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaValue: '20' },
            ],
          },
        ],
      },
    });
    assert.equal(r.reason, 'QUOTA_DAILY');
  });

  test('a daily cap is not worth retrying', () => {
    const r = readGeminiQuota({
      error: {
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
            violations: [{ quotaId: 'GenerateRequestsPerDayPerProject' }],
          },
        ],
      },
    });
    assert.equal(r.reason, 'QUOTA_DAILY');
  });
});
