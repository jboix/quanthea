/**
 * Caps how many tasks run at once: in all, and per key such as a connector. Tasks past a cap wait
 * in order and start as others finish.
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
   * @param key - What the task counts against, such as its connector.
   * @param task - The task.
   * @returns What the task returns.
   */
  run<Result>(key: string, task: () => Promise<Result>): Promise<Result>;
}

/** A task waiting for room. */
interface Waiting {
  /** Its key. */
  readonly key: string;
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
  const hasRoom = (key: string) => total < caps.global && (running.get(key) ?? 0) < caps.perKey;
  const take = (key: string) => {
    total += 1;
    running.set(key, (running.get(key) ?? 0) + 1);
  };
  const release = (key: string) => {
    total -= 1;
    running.set(key, (running.get(key) ?? 1) - 1);
    const next = waiting.findIndex((each) => hasRoom(each.key));
    if (next >= 0) waiting.splice(next, 1)[0]?.start();
  };
  return {
    run(key, task) {
      return new Promise((resolve, reject) => {
        const start = () => {
          take(key);
          Promise.resolve()
            .then(task)
            .then(resolve, reject)
            .finally(() => release(key));
        };
        if (hasRoom(key)) start();
        else waiting.push({ key, start });
      });
    },
  };
}
