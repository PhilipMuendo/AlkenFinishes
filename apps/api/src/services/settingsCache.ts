/**
 * A config row that changes a few times a year but is read on nearly every
 * request. Extracted from services/finance.ts's getFinanceSettings, which
 * had this exact pattern (module-level cache, TTL, explicit clear-on-write)
 * and nothing else did — every other settings getter hit the DB fresh on
 * every call for no reason tied to actual write frequency.
 *
 * One instance per config domain, created at module scope in the owning
 * service file, so a change to one config's cache can never accidentally
 * clear another's.
 */
export function cachedSetting<T>(loader: () => Promise<T>, ttlMs = 60_000) {
  let cache: { at: number; value: T } | null = null;
  return {
    get: async (): Promise<T> => {
      if (cache && Date.now() - cache.at < ttlMs) return cache.value;
      const value = await loader();
      cache = { at: Date.now(), value };
      return value;
    },
    /** Called by the settings route after the row is saved. */
    clear: () => {
      cache = null;
    },
  };
}
