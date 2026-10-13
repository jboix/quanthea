/**
 * Caps how many tasks run at once: in all, and per key such as a connector. Tasks past a cap wait
 * in order and start as others finish. A task that counts against several keys starts once every
 * one of them has room, and takes its place on all of them at once, so two such tasks never wait
 * for each other.
 */

/** The caps. */
export interface LimiterCaps {
  /** The most tasks running at once in all. */
  readonly global: number;
  /** The most tasks running at once for one key. */
  readonly perKey: number;
}

/** Runs tasks within the caps. */
export interface Limiter {
  /**
   * Runs a task once the caps allow it.
   *
   * @param key - What the task counts against, such as its connector, or each of several.
   * @param task - The task.
   * @returns What the task returns.
   */
  run<Result>(key: string | readonly string[], task: () => Promise<Result>): Promise<Result>;
}

/** A task waiting for room. */
interface Waiting {
  /** Its keys. */
  readonly keys: readonly string[];
  /** Starts it. */
  readonly start: () => void;
}

/**
 * Creates a limiter.
 *
 * @param caps - The caps.
 * @returns The limiter.
 */
export function createLimiter(caps: LimiterCaps): Limiter {
  const running = new Map<string, number>();
  const waiting: Waiting[] = [];
  let total = 0;
  const hasRoom = (keys: readonly string[]) =>
    total < caps.global && keys.every((key) => (running.get(key) ?? 0) < caps.perKey);
  const count = (keys: readonly string[], by: number) => {
    total += by;
    for (const key of keys) running.set(key, (running.get(key) ?? 0) + by);
  };
  const release = (keys: readonly string[]) => {
    count(keys, -1);
    // One task leaving may make room for several: a task on two keys frees both.
    for (let next = nextWaiting(); next >= 0; next = nextWaiting())
      waiting.splice(next, 1)[0]?.start();
  };
  const nextWaiting = () => waiting.findIndex((each) => hasRoom(each.keys));
  return {
    run(key, task) {
      const keys = [...new Set([key].flat())];
      return new Promise((resolve, reject) => {
        const start = () => {
          count(keys, 1);
          Promise.resolve()
            .then(task)
            .then(resolve, reject)
            .finally(() => release(keys));
        };
        if (hasRoom(keys)) start();
        else waiting.push({ keys, start });
      });
    },
  };
}
