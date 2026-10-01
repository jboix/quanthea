/** Keeps query results for a few seconds, so panels that ask for the same data share one query. */
import type { Frame } from '@quanthea/shared';

/** A short-lived cache of query results. */
export interface ResultCache {
  /**
   * Reads a result that has not expired.
   *
   * @param key - The cache key.
   * @returns The frames, or `undefined`.
   */
  get(key: string): readonly Frame[] | undefined;
  /**
   * Stores a result.
   *
   * @param key - The cache key.
   * @param frames - The frames.
   */
  set(key: string, frames: readonly Frame[]): void;
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
export function createResultCache(options: ResultCacheOptions): ResultCache {
  const now = options.now ?? Date.now;
  const entries = new Map<
    string,
    { readonly expires: number; readonly frames: readonly Frame[] }
  >();
  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expires > now()) return entry.frames;
      entries.delete(key);
      return undefined;
    },
    set(key, frames) {
      entries.delete(key);
      entries.set(key, { expires: now() + options.ttlMs, frames });
      const oldest = entries.keys().next().value;
      if (entries.size > options.maxEntries && oldest !== undefined) entries.delete(oldest);
    },
  };
}
