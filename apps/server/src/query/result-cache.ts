/**
 * Keeps query results for a few seconds, so panels that ask for the same data share one query. The
 * same cache keeps the options of query-backed variables.
 */
import type { Frame } from '@quanthea/shared';

/** A short-lived cache of query results: frames by default, or another value such as options. */
export interface ResultCache<Value = readonly Frame[]> {
  /**
   * Reads a result that has not expired.
   *
   * @param key - The cache key.
   * @returns The value, or `undefined`.
   */
  get(key: string): Value | undefined;
  /**
   * Stores a result.
   *
   * @param key - The cache key.
   * @param value - The value, such as the frames.
   */
  set(key: string, value: Value): void;
}

/** How to build a cache. */
interface ResultCacheOptions {
  /** How long a result stays, in milliseconds. */
  readonly ttlMs: number;
  /** How many results it holds; the oldest go first. */
  readonly maxEntries: number;
  /** The clock, in epoch milliseconds. */
  readonly now?: () => number;
}

/**
 * Creates a cache.
 *
 * @param options - Lifetime, size and clock.
 * @returns The cache.
 */
export function createResultCache<Value = readonly Frame[]>(
  options: ResultCacheOptions,
): ResultCache<Value> {
  const now = options.now ?? Date.now;
  const entries = new Map<string, { readonly expires: number; readonly value: Value }>();
  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expires > now()) return entry.value;
      entries.delete(key);
      return undefined;
    },
    set(key, value) {
      entries.delete(key);
      entries.set(key, { expires: now() + options.ttlMs, value });
      const oldest = entries.keys().next().value;
      if (entries.size > options.maxEntries && oldest !== undefined) entries.delete(oldest);
    },
  };
}
