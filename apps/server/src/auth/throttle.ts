/**
 * Throttles failed attempts: past a number of free failures, a key (an IP address, or an account)
 * waits, and the wait doubles with each further failure up to a cap. Nothing ever locks an account
 * for good, so no one can lock someone out by guessing wrong on purpose. Held in memory; a restart
 * forgets it.
 */

/** How a kind of key is throttled. */
export interface ThrottleRule {
  /** Failures allowed before the first wait. */
  readonly freeFailures: number;
  /** The first wait. */
  readonly firstWaitMs: number;
  /** The longest wait. */
  readonly longestWaitMs: number;
  /** A key with no failure for this long starts over. */
  readonly forgetAfterMs: number;
}

/** Waits for accounts: 5 free failures, then 1 minute, doubling up to an hour. */
export const accountRule: ThrottleRule = {
  freeFailures: 5,
  firstWaitMs: 60_000,
  longestWaitMs: 3_600_000,
  forgetAfterMs: 24 * 3_600_000,
};

/** Waits for IP addresses: 20 free failures, then 1 minute, doubling up to 15 minutes. */
export const addressRule: ThrottleRule = {
  freeFailures: 20,
  firstWaitMs: 60_000,
  longestWaitMs: 15 * 60_000,
  forgetAfterMs: 3_600_000,
};

/** The most keys held; the oldest are forgotten first. */
const maximumKeys = 50_000;

/** A key's failures. */
interface Entry {
  /** Failures since it started over. */
  readonly failures: number;
  /** The last failure. */
  readonly lastFailureAt: number;
  /** Until when it waits. */
  readonly waitUntil: number;
}

/** A throttle for one kind of key. */
export interface Throttle {
  /**
   * How long a key must still wait.
   *
   * @param key - The key.
   * @returns Milliseconds; 0 when it may try now.
   */
  waitFor(key: string): number;
  /**
   * Records a failure.
   *
   * @param key - The key.
   */
  fail(key: string): void;
  /**
   * Forgets a key's failures, after a success.
   *
   * @param key - The key.
   */
  forget(key: string): void;
}

/**
 * Creates a throttle.
 *
 * @param rule - How keys are throttled.
 * @param now - The clock; `Date.now` by default.
 * @returns The throttle.
 */
export function createThrottle(rule: ThrottleRule, now: () => number = Date.now): Throttle {
  const entries = new Map<string, Entry>();
  return {
    waitFor: (key) => Math.max(0, (entries.get(key)?.waitUntil ?? 0) - now()),
    fail: (key) => {
      const at = now();
      const before = entries.get(key);
      const fresh = !before || at - before.lastFailureAt > rule.forgetAfterMs;
      const failures = fresh ? 1 : before.failures + 1;
      const over = failures - rule.freeFailures;
      const wait = over > 0 ? Math.min(rule.longestWaitMs, rule.firstWaitMs * 2 ** (over - 1)) : 0;
      entries.delete(key);
      entries.set(key, { failures, lastFailureAt: at, waitUntil: at + wait });
      if (entries.size > maximumKeys) entries.delete(entries.keys().next().value ?? '');
    },
    forget: (key) => void entries.delete(key),
  };
}
