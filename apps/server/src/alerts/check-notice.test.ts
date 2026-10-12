import { describe, expect, test } from 'bun:test';
import { checkable } from '../db/alert-checks.ts';
import type { CheckState } from '../db/alert-state-repository.ts';
import { checkNotification, decideCheck, failuresBeforeError } from './check-notice.ts';
import { spec } from './test/fixtures.ts';

/**
 * Runs evaluations through the decision, failing or passing in turn.
 *
 * @param failures - For each evaluation, why its query failed, or `null` when it ran.
 * @param quiet - Whether messages are held back at each evaluation; never by default.
 * @param held - Whether quiet hours hold at each evaluation; never by default.
 * @returns The events sent, the records and the last state.
 */
function run(
  failures: readonly (string | null)[],
  quiet: (index: number) => boolean = () => false,
  held: (index: number) => boolean = () => false,
) {
  let state: CheckState = checkable;
  const events: (string | null)[] = [];
  const records: string[] = [];
  failures.forEach((failure, index) => {
    const facts = { failure, quiet: quiet(index), held: held(index), now: index };
    const decision = decideCheck(state, facts);
    state = decision.state;
    events.push(decision.event);
    const mark = decision.record?.quiet ? ', held' : '';
    if (decision.record) records.push(`${decision.record.kind}@${index}${mark}`);
  });
  return { events, records, state };
}

describe('whether an alert can be checked', () => {
  test('one failure is a blip: no error, nothing sent', () => {
    expect(failuresBeforeError).toBe(2);
    const { events, records } = run(['down', null]);
    expect(events).toEqual([null, null]);
    expect(records).toEqual([]);
  });

  test('says it cannot be checked once, after two failures in a row', () => {
    const { events, records, state } = run(['down', 'down', 'down', 'down']);
    expect(events).toEqual([null, 'alert.error', null, null]);
    expect(records).toEqual(['error@1']);
    expect(state).toEqual({ failures: 4, errorSince: 1, notified: true });
  });

  test('says once it can be checked again', () => {
    const { events, records, state } = run(['down', 'down', null, null]);
    expect(events).toEqual([null, 'alert.error', 'alert.recovered', null]);
    expect(records).toEqual(['error@1', 'recovered@2']);
    expect(state).toEqual(checkable);
  });

  test('a mute holds the message back until it ends', () => {
    const { events, records } = run(['down', 'down', 'down', null], (index) => index < 2);
    expect(events).toEqual([null, null, 'alert.error', 'alert.recovered']);
    expect(records).toEqual(['error@1', 'error@2', 'recovered@3']);
  });

  test('with the setting off, it records and says nothing, recovery included', () => {
    const { events, records } = run(['down', 'down', null], () => true);
    expect(events).toEqual([null, null, null]);
    expect(records).toEqual(['error@1', 'recovered@2']);
  });

  test('quiet hours hold the error back until they end', () => {
    const night = (index: number) => index < 3;
    const { events, records } = run(['down', 'down', 'down', 'down'], undefined, night);
    expect(events).toEqual([null, null, null, 'alert.error']);
    expect(records).toEqual(['error@1, held', 'error@3']);
  });

  test('an error and its recovery inside quiet hours say nothing', () => {
    const night = (index: number) => index < 3;
    const { events, state } = run(['down', 'down', null, null], undefined, night);
    expect(events).toEqual([null, null, null, null]);
    expect(state).toEqual(checkable);
  });

  test('a recovery it owes waits for quiet hours to end', () => {
    const night = (index: number) => index >= 2 && index < 4;
    const { events, records, state } = run(['down', 'down', null, null, null], undefined, night);
    expect(events).toEqual([null, 'alert.error', null, null, 'alert.recovered']);
    expect(records).toEqual(['error@1', 'recovered@2, held', 'recovered@4']);
    expect(state).toEqual(checkable);
  });

  test('builds the fixed message, with the reason cut short', () => {
    const subject = { alertId: 'a1', version: 2, spec: spec(), url: '/alerts/a1' };
    const notification = checkNotification(subject, 'alert.error', 'x'.repeat(400), 0);
    expect(notification.series).toEqual({ key: '', labels: {} });
    expect(notification.template.body).toBe('{alert} cannot be checked: {reason}');
    expect(notification.values.reason).toHaveLength(300);
    const recovered = checkNotification(subject, 'alert.recovered', null, 0);
    expect(recovered.template.title).toBe('{alert} can be checked again');
    expect(recovered.values.reason).toBeUndefined();
  });
});
