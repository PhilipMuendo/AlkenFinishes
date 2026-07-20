import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../utils/http';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Minimal fixed-window in-memory rate limiter. Sufficient for a single-process
 * deployment; swap for a Redis-backed limiter when running replicas.
 */
export function makeLimiter(opts: {
  windowMs: number;
  max: number;
  keyFn?: (req: Request) => string;
  message?: string;
}) {
  const buckets = new Map<string, Bucket>();
  // Bound memory: sweep expired buckets periodically.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }, opts.windowMs);
  sweep.unref();

  return (req: Request, _res: Response, next: NextFunction) => {
    const key = opts.keyFn ? opts.keyFn(req) : (req.ip ?? 'unknown');
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
      return next();
    }
    bucket.count += 1;
    if (bucket.count > opts.max) {
      return next(new ApiError(429, opts.message ?? 'Too many requests, try again later'));
    }
    next();
  };
}

export const loginLimiter = makeLimiter({
  windowMs: 15 * 60_000,
  max: 10,
  keyFn: (req) => `${req.ip}:${String(req.body?.email ?? '').toLowerCase()}`,
  message: 'Too many login attempts. Try again in 15 minutes.',
});

export const deviceSyncLimiter = makeLimiter({
  windowMs: 60_000,
  max: 30,
  keyFn: (req) => `dev:${String(req.headers['x-device-key'] ?? req.ip).slice(0, 32)}`,
});
