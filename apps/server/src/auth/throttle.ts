/**
 * Throttles failed attempts: past a number of free failures, a key (an IP address, or an account)
 * waits, and the wait doubles with each further failure up to a cap. Nothing ever locks an account
 * for good, so no one can lock someone out by guessing wrong on purpose. Held in memory; a restart
 * forgets it. A caller records a failure before the costly check and undoes it after a success, so
 * attempts that arrive at once cannot all pass the check.
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

/** The most keys held; the oldest that no longer wait are forgotten first. */
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
   * Takes back one failure, recorded before an attempt that then succeeded.
   *
   * @param key - The key.
   */
  undo(key: string): void;
  /**
   * Forgets a key's failures, after a success.
   *
   * @param key - The key.
   */
  forget(key: string): void;
}

/**
 * How long a key waits after a number of failures.
 *
 * @param rule - How keys are throttled.
 * @param failures - The failures since it started over.
 * @returns Milliseconds.
 */
function waitAfter(rule: ThrottleRule, failures: number): number {
  const over = failures - rule.freeFailures;
  return over > 0 ? Math.min(rule.longestWaitMs, rule.firstWaitMs * 2 ** (over - 1)) : 0;
}

/**
 * Forgets one key when there are too many: the oldest that no longer waits, or the oldest of all
 * when every key waits. The key just recorded is kept.
 *
 * @param entries - The keys, oldest first.
 * @param kept - The key just recorded.
 * @param at - Now.
 */
function forgetOne(entries: Map<string, Entry>, kept: string, at: number): void {
  if (entries.size <= maximumKeys) return;
  for (const [key, entry] of entries) {
    if (key !== kept && entry.waitUntil <= at) {
      entries.delete(key);
      return;
    }
  }
  entries.delete(entries.keys().next().value ?? '');
}

/**
 * Takes back one failure of a key.
 *
 * @param rule - How keys are throttled.
 * @param entries - The keys.
 * @param key - The key.
 */
function undoFailure(rule: ThrottleRule, entries: Map<string, Entry>, key: string): void {
  const before = entries.get(key);
  if (!before) return;
  const failures = before.failures - 1;
  if (failures <= 0) {
    entries.delete(key);
    return;
  }
  const waitUntil = before.lastFailureAt + waitAfter(rule, failures);
  entries.set(key, { failures, lastFailureAt: before.lastFailureAt, waitUntil });
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
      entries.delete(key);
      entries.set(key, { failures, lastFailureAt: at, waitUntil: at + waitAfter(rule, failures) });
      forgetOne(entries, key, at);
    },
    undo: (key) => undoFailure(rule, entries, key),
    forget: (key) => {
      entries.delete(key);
    },
  };
}
