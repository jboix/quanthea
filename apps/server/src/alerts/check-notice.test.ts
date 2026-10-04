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
 * @returns The events sent, the records and the last state.
 */
function run(
  failures: readonly (string | null)[],
  quiet: (index: number) => boolean = () => false,
) {
  let state: CheckState = checkable;
  const events: (string | null)[] = [];
  const records: string[] = [];
  failures.forEach((failure, index) => {
    const decision = decideCheck(state, { failure, quiet: quiet(index), now: index });
    state = decision.state;
    events.push(decision.event);
    if (decision.record) records.push(`${decision.record.kind}@${index}`);
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
