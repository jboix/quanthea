/**
 * Caps how many tasks run at once: in all, and per key such as a connector. Tasks past a cap wait
 * in order and start as others finish. A task that counts against several keys starts once every
 * one of them has room, and takes its place on all of them at once, so two such tasks never wait
 * for each other. A task with room starts ahead of an older one that still waits for another key,
 * but only a few times: then the older one holds its keys until it has run.
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
  /** How many tasks that came later started on one of its keys while it waited. */
  overtaken: number;
}

/**
 * How many later tasks may start ahead of a waiting one on a key it needs. Past it the waiting
 * task holds its keys: nothing later starts on them until it has run. A task on two busy keys
 * would else wait for as long as each key always had another task to start.
 */
const maxOvertakes = 3;

/** What a limiter keeps. */
interface LimiterState {
  /** The caps. */
  readonly caps: LimiterCaps;
  /** How many tasks run on each key. */
  readonly running: Map<string, number>;
  /** The tasks waiting, oldest first. */
  readonly waiting: Waiting[];
  /** How many tasks run in all. */
  total: number;
}

/**
 * Whether a task shares a key with others.
 *
 * @param each - The task.
 * @param keys - The keys of the others.
 * @returns `true` when one of its keys is among them.
 */
function shares(each: Waiting, keys: Iterable<string>): boolean {
  const others = new Set(keys);
  return each.keys.some((key) => others.has(key));
}

/**
 * Whether the caps leave room for a task.
 *
 * @param state - The limiter.
 * @param keys - The task's keys.
 * @returns `true` when it fits in all and on each of its keys.
 */
function hasRoom(state: LimiterState, keys: readonly string[]): boolean {
  if (state.total >= state.caps.global) return false;
  return keys.every((key) => (state.running.get(key) ?? 0) < state.caps.perKey);
}

/**
 * Counts a task in or out, and tells the waiting tasks it passed that it started ahead of them.
 *
 * @param state - The limiter.
 * @param keys - The task's keys.
 * @param by - 1 as it starts, -1 as it ends.
 * @param passed - The tasks that waited before it and still wait, as it starts.
 */
function count(
  state: LimiterState,
  keys: readonly string[],
  by: number,
  passed: readonly Waiting[] = [],
): void {
  state.total += by;
  for (const key of keys) state.running.set(key, (state.running.get(key) ?? 0) + by);
  for (const each of passed) if (shares(each, keys)) each.overtaken += 1;
}

/**
 * The oldest waiting task that may start: it has room, and no older task that was overtaken too
 * often holds one of its keys.
 *
 * @param state - The limiter.
 * @returns Its place in the queue, or -1 when none may start.
 */
function nextWaiting(state: LimiterState): number {
  const held = new Set<string>();
  return state.waiting.findIndex((each) => {
    const free = !shares(each, held) && hasRoom(state, each.keys);
    if (!free && each.overtaken >= maxOvertakes) for (const key of each.keys) held.add(key);
    return free;
  });
}

/**
 * Whether a task that arrives may start at once: it has room, and no waiting task that was
 * overtaken too often holds one of its keys.
 *
 * @param state - The limiter.
 * @param keys - The task's keys.
 * @returns `true` when it need not wait.
 */
function mayStart(state: LimiterState, keys: readonly string[]): boolean {
  const held = state.waiting.some((each) => each.overtaken >= maxOvertakes && shares(each, keys));
  return !held && hasRoom(state, keys);
}

/**
 * Takes a finished task out, and starts the waiting tasks it made room for. One task leaving may
 * make room for several: a task on two keys frees both.
 *
 * @param state - The limiter.
 * @param keys - The finished task's keys.
 */
function release(state: LimiterState, keys: readonly string[]): void {
  count(state, keys, -1);
  for (let next = nextWaiting(state); next >= 0; next = nextWaiting(state)) {
    const [task] = state.waiting.splice(next, 1);
    count(state, task?.keys ?? [], 1, state.waiting.slice(0, next));
    task?.start();
  }
}

/**
 * Creates a limiter.
 *
 * @param caps - The caps.
 * @returns The limiter.
 */
export function createLimiter(caps: LimiterCaps): Limiter {
  const state: LimiterState = { caps, running: new Map(), waiting: [], total: 0 };
  return {
    run(key, task) {
      const keys = [...new Set([key].flat())];
      return new Promise((resolve, reject) => {
        const start = () => {
          Promise.resolve()
            .then(task)
            .then(resolve, reject)
            .finally(() => release(state, keys));
        };
        if (!mayStart(state, keys)) return void state.waiting.push({ keys, start, overtaken: 0 });
        count(state, keys, 1, state.waiting);
        start();
      });
    },
  };
}
