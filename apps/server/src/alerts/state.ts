/**
 * The state machine of one series. Each evaluation observes the series and moves it:
 * `ok → pending` when the condition holds, `pending → firing` once it has held for `for`,
 * `pending → ok` and `firing → ok` when it stops holding. A series the result leaves out while
 * others come back resolves after a grace period; an empty result is `no_data`, a failed query
 * `error`. Pure: the evaluator and the replay feed it the same way.
 */
import type { AlertState } from '@quanthea/shared';

/** What an evaluation observed of a series. */
export type Observation =
  /** The series came back: its value, and whether the condition holds for it. */
  | { readonly kind: 'value'; readonly value: number | null; readonly holds: boolean }
  /** The result left the series out while others came back. */
  | { readonly kind: 'missing' }
  /** The result was empty. */
  | { readonly kind: 'no_data' }
  /** The query failed. */
  | { readonly kind: 'error'; readonly message: string };

/** The state of a series between evaluations. */
export interface SeriesState {
  /** Its state. */
  readonly state: AlertState;
  /** When it entered that state, in epoch milliseconds. */
  readonly since: number;
  /** When the result last held it. */
  readonly lastSeenAt: number;
  /** Its last value. */
  readonly value: number | null;
}

/** The timing of the condition. */
export interface StateRule {
  /** How long the condition holds before the series fires, in milliseconds. */
  readonly forMs: number;
  /** How long a series may be left out of the result before it resolves, in milliseconds. */
  readonly graceMs: number;
}

/** A change of state. */
export interface Transition {
  /** The state before. */
  readonly from: AlertState;
  /** The state after. */
  readonly to: AlertState;
  /** When, in epoch milliseconds. */
  readonly at: number;
  /** The value observed. */
  readonly value: number | null;
  /** Why the query failed, for a change to `error`. */
  readonly message: string | null;
}

/** What one evaluation did to a series. */
export interface Step {
  /** The new state, or `null` when the series is gone. */
  readonly next: SeriesState | null;
  /** The change of state, if any. */
  readonly transition: Transition | null;
}

/**
 * Moves a series to a state.
 *
 * @param from - The state before.
 * @param to - The state after.
 * @param at - When.
 * @param details - The value, when the result held the series, and the error message.
 * @returns The step.
 */
function move(
  from: SeriesState,
  to: AlertState,
  at: number,
  details: { readonly value?: number | null; readonly message?: string } = {},
): Step {
  const value = details.value === undefined ? from.value : details.value;
  const lastSeenAt = details.value === undefined ? from.lastSeenAt : at;
  const next = { state: to, since: from.state === to ? from.since : at, lastSeenAt, value };
  if (from.state === to) return { next, transition: null };
  return {
    next,
    transition: { from: from.state, to, at, value, message: details.message ?? null },
  };
}

/**
 * The state a series moves to when the condition holds.
 *
 * @param from - The state before.
 * @param at - When.
 * @param rule - The timing of the condition.
 * @returns The new state.
 */
function holdingState(from: SeriesState, at: number, rule: StateRule): AlertState {
  if (from.state === 'firing') return 'firing';
  if (from.state === 'pending') return at - from.since >= rule.forMs ? 'firing' : 'pending';
  return rule.forMs <= 0 ? 'firing' : 'pending';
}

/**
 * The step of a series the result left out.
 *
 * @param previous - Its state before, if it had one.
 * @param at - When.
 * @param rule - The grace period.
 * @returns The step: unchanged within the grace period, then gone, resolving if it was not ok.
 */
function missingStep(previous: SeriesState | undefined, at: number, rule: StateRule): Step {
  if (!previous) return { next: null, transition: null };
  if (at - previous.lastSeenAt < rule.graceMs) return { next: previous, transition: null };
  return { next: null, transition: move(previous, 'ok', at).transition };
}

/**
 * Moves a series by one evaluation.
 *
 * @param previous - Its state before; a new series starts `ok`.
 * @param observation - What the evaluation observed.
 * @param rule - The timing of the condition.
 * @param at - When the evaluation ran, in epoch milliseconds.
 * @returns The new state, or `null` when the series is gone, and the change of state.
 */
export function stepSeries(
  previous: SeriesState | undefined,
  observation: Observation,
  rule: StateRule,
  at: number,
): Step {
  const from = previous ?? { state: 'ok', since: at, lastSeenAt: at, value: null };
  switch (observation.kind) {
    case 'missing':
      return missingStep(previous, at, rule);
    case 'no_data':
      return move(from, 'no_data', at);
    case 'error':
      return move(from, 'error', at, { message: observation.message });
    default: {
      const to = observation.holds ? holdingState(from, at, rule) : 'ok';
      return move(from, to, at, { value: observation.value });
    }
  }
}
