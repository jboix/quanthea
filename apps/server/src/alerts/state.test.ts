import { describe, expect, test } from 'bun:test';
import { type Observation, type SeriesState, stepSeries } from './state.ts';

const minute = 60_000;
const rule = { forMs: 5 * minute, graceMs: 3 * minute };

/**
 * An observed value.
 *
 * @param value - The value.
 * @param holds - Whether the condition holds.
 * @returns The observation.
 */
const seen = (value: number, holds: boolean): Observation => ({ kind: 'value', value, holds });

/**
 * A series in a state.
 *
 * @param state - The state.
 * @param since - When it entered it.
 * @param lastSeenAt - When the result last held it.
 * @returns The series state.
 */
function inState(state: SeriesState['state'], since = 0, lastSeenAt = since): SeriesState {
  return { state, since, lastSeenAt, value: 1 };
}

describe('a series that comes back', () => {
  test('stays ok while the condition does not hold, with no change', () => {
    const step = stepSeries(undefined, seen(1, false), rule, 0);
    expect(step.next).toEqual({ state: 'ok', since: 0, lastSeenAt: 0, value: 1 });
    expect(step.transition).toBeNull();
  });

  test('goes pending when the condition holds', () => {
    const step = stepSeries(inState('ok'), seen(9, true), rule, minute);
    expect(step.next?.state).toBe('pending');
    expect(step.transition).toEqual({
      from: 'ok',
      to: 'pending',
      at: minute,
      value: 9,
      message: null,
    });
  });

  test('stays pending until the condition has held for `for`, then fires', () => {
    const pending = inState('pending', minute);
    expect(stepSeries(pending, seen(9, true), rule, 5 * minute).transition).toBeNull();
    const step = stepSeries(pending, seen(9, true), rule, 6 * minute);
    expect(step.transition?.to).toBe('firing');
    expect(step.next?.since).toBe(6 * minute);
  });

  test('fires at once with a `for` of zero', () => {
    const step = stepSeries(inState('ok'), seen(9, true), { ...rule, forMs: 0 }, minute);
    expect(step.transition).toMatchObject({ from: 'ok', to: 'firing' });
  });

  test('keeps firing while the condition holds, keeping its since', () => {
    const step = stepSeries(inState('firing', minute), seen(10, true), rule, 9 * minute);
    expect(step.transition).toBeNull();
    expect(step.next).toEqual({
      state: 'firing',
      since: minute,
      lastSeenAt: 9 * minute,
      value: 10,
    });
  });

  test('goes back to ok from pending: too short to fire', () => {
    const step = stepSeries(inState('pending', minute), seen(1, false), rule, 3 * minute);
    expect(step.transition).toMatchObject({ from: 'pending', to: 'ok' });
  });

  test('resolves from firing when the condition stops holding', () => {
    const step = stepSeries(inState('firing', minute), seen(1, false), rule, 9 * minute);
    expect(step.transition).toMatchObject({ from: 'firing', to: 'ok', value: 1 });
  });

  test('recovers from no data or an error like from ok', () => {
    expect(stepSeries(inState('no_data'), seen(1, false), rule, minute).transition?.to).toBe('ok');
    expect(stepSeries(inState('error'), seen(9, true), rule, minute).transition?.to).toBe(
      'pending',
    );
  });
});

describe('a series the result does not hold', () => {
  test('goes to no_data when the result is empty, once', () => {
    const step = stepSeries(inState('firing'), { kind: 'no_data' }, rule, minute);
    expect(step.transition).toMatchObject({ from: 'firing', to: 'no_data' });
    expect(step.next?.value).toBe(1);
    expect(
      stepSeries(step.next ?? undefined, { kind: 'no_data' }, rule, 2 * minute).transition,
    ).toBeNull();
  });

  test('goes to error when the query fails, once, with why', () => {
    const step = stepSeries(inState('ok'), { kind: 'error', message: 'timeout' }, rule, minute);
    expect(step.transition).toMatchObject({ from: 'ok', to: 'error', message: 'timeout' });
    const again = stepSeries(
      step.next ?? undefined,
      { kind: 'error', message: 'timeout' },
      rule,
      2 * minute,
    );
    expect(again.transition).toBeNull();
    expect(again.next?.since).toBe(minute);
  });

  test('keeps its state while missing within the grace period', () => {
    const firing = inState('firing', 0, minute);
    const step = stepSeries(firing, { kind: 'missing' }, rule, 3 * minute);
    expect(step).toEqual({ next: firing, transition: null });
  });

  test('resolves and goes after the grace period', () => {
    const step = stepSeries(inState('firing', 0, minute), { kind: 'missing' }, rule, 4 * minute);
    expect(step.next).toBeNull();
    expect(step.transition).toMatchObject({ from: 'firing', to: 'ok', at: 4 * minute });
  });

  test('goes quietly when it was ok, or when it was never known', () => {
    expect(stepSeries(inState('ok'), { kind: 'missing' }, rule, 9 * minute)).toEqual({
      next: null,
      transition: null,
    });
    expect(stepSeries(undefined, { kind: 'missing' }, rule, 0)).toEqual({
      next: null,
      transition: null,
    });
  });
});
