import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Frame, Notification } from '@quanthea/shared';
import { createAlertRepository } from '../db/alert-repository.ts';
import { createAlertStateRepository } from '../db/alert-state-repository.ts';
import { openDatabase } from '../db/database.ts';
import { runMigrations } from '../db/migrate.ts';
import { captureLogs, temporaryDir } from '../test/fixtures.ts';
import { evaluateAlert } from './evaluate.ts';
import { type FakeAnswer, fakeEngine, minute, seriesFrame, spec } from './test/fixtures.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let database: ReturnType<typeof openDatabase>;

beforeEach(() => {
  dataDir = temporaryDir();
  database = openDatabase(dataDir.path);
  runMigrations(database);
});

afterEach(() => {
  database.close();
  dataDir.remove();
});

/**
 * An active alert over a fake engine, evaluated at chosen instants with chosen frames.
 *
 * @param overrides - Fields of the spec to replace.
 * @returns The evaluation, the notifications sent, the stores and the logs.
 */
function harness(overrides: Record<string, unknown> = {}) {
  const alerts = createAlertRepository(database);
  const states = createAlertStateRepository(database);
  const alertSpec = spec(overrides);
  const at = 0;
  alerts.addVersion({
    alertId: 'a1',
    title: 'Checkout 5xx',
    spec: alertSpec,
    note: null,
    createdBy: 'ada',
    createdAt: at,
  });
  alerts.activate('a1', 1, at);
  let answer: FakeAnswer = [];
  const engine = fakeEngine(() => answer);
  const sent: Notification[] = [];
  const logs = captureLogs();
  const notify = (_channels: readonly string[], notification: Notification) => {
    sent.push(notification);
    return Promise.resolve();
  };
  const setting = { notifyOnError: true };
  const dependencies = {
    ...engine,
    states,
    notify,
    logger: logs.logger,
    alertUrl: () => '/alerts/a1',
    notifyOnError: () => setting.notifyOnError,
  };
  const evaluate = async (now: number, next: FakeAnswer) => {
    answer = next;
    const alert = alerts.get('a1');
    if (alert) await evaluateAlert(dependencies, { alert, spec: alertSpec }, now);
  };
  return { evaluate, sent, states, alerts, logs, dependencies, setting };
}

/**
 * The frames of one series at one value.
 *
 * @param value - The value.
 * @param labels - The labels.
 * @returns The frames.
 */
const at = (value: number, labels: Record<string, string> = { service: 'checkout' }): Frame[] => [
  seriesFrame(labels, [[0, value]]),
];

describe('evaluating an alert', () => {
  test('fires once the condition held for `for`, notifies once, then resolves', async () => {
    const { evaluate, sent, states } = harness({ notify: { onResolved: true } });
    for (let minutes = 1; minutes <= 7; minutes += 1) await evaluate(minutes * minute, at(9));
    expect(sent.map((each) => each.event)).toEqual(['alert.firing']);
    expect(sent[0]?.values.series).toBe('service=checkout');
    expect(states.series('a1')[0]).toMatchObject({
      state: 'firing',
      since: 6 * minute,
      announced: true,
    });
    await evaluate(8 * minute, at(1));
    expect(sent.map((each) => each.event)).toEqual(['alert.firing', 'alert.resolved']);
    const events = states.events('a1', 10).reverse();
    expect(events.map((event) => [event.from, event.to, event.notified])).toEqual([
      ['ok', 'pending', false],
      ['pending', 'firing', true],
      ['firing', 'ok', true],
    ]);
  });

  test('keeps evaluating while muted but sends nothing, and announces after the mute', async () => {
    const { evaluate, sent, states, alerts } = harness({
      condition: { kind: 'threshold', op: 'above', value: 5, for: '0m' },
    });
    alerts.setMute('a1', { at: 0, by: 'ada', until: 5 * minute }, 0);
    await evaluate(minute, at(9));
    expect(sent).toEqual([]);
    expect(states.series('a1')[0]?.state).toBe('firing');
    await evaluate(6 * minute, at(9));
    expect(sent.map((each) => each.event)).toEqual(['alert.firing']);
  });

  test('notifies again every repeatEvery while it keeps firing', async () => {
    const { evaluate, sent } = harness({
      condition: { kind: 'threshold', op: 'above', value: 5, for: '0m' },
      notify: { onResolved: false, repeatEvery: '5m' },
    });
    for (let minutes = 1; minutes <= 11; minutes += 1) await evaluate(minutes * minute, at(9));
    expect(sent.map((each) => each.at)).toEqual(
      [1, 6, 11].map((minutes) => new Date(minutes * minute).toISOString()),
    );
    await evaluate(12 * minute, at(1));
    expect(sent).toHaveLength(3);
  });

  test('records a failing query once, logs it once, and one failure notifies no one', async () => {
    const { evaluate, sent, states, logs } = harness();
    await evaluate(minute, new Error('Prometheus is down.'));
    expect(states.series('a1')).toMatchObject([{ key: '', state: 'error' }]);
    expect(states.events('a1', 10)).toMatchObject([{ to: 'error', message: expect.any(String) }]);
    expect(logs.lines.filter((line) => line.message === 'an alert query failed')).toHaveLength(1);
    await evaluate(2 * minute, at(1));
    expect(sent).toEqual([]);
    expect(states.series('a1').map((row) => row.key)).toEqual(['{service="checkout"}']);
    expect(states.events('a1', 1)[0]).toMatchObject({ from: 'error', to: 'ok' });
    expect(states.checkEvents('a1', 10)).toEqual([]);
  });

  test('says once it cannot be checked after two failures, and once it can again', async () => {
    const { evaluate, sent, states, logs } = harness();
    for (let minutes = 1; minutes <= 4; minutes += 1)
      await evaluate(minutes * minute, new Error('Prometheus is down.'));
    expect(sent.map((each) => each.event)).toEqual(['alert.error']);
    expect(sent[0]?.values).toMatchObject({ alert: 'Checkout 5xx', reason: expect.any(String) });
    expect(sent[0]?.template.title).toBe('{alert} cannot be checked');
    expect(logs.lines.filter((line) => line.message === 'an alert query failed')).toHaveLength(1);
    await evaluate(5 * minute, at(1));
    await evaluate(6 * minute, at(1));
    expect(sent.map((each) => each.event)).toEqual(['alert.error', 'alert.recovered']);
    expect(states.checkEvents('a1', 10)).toMatchObject([
      { kind: 'recovered', at: 5 * minute, notified: true },
      { kind: 'error', at: 2 * minute, notified: true, reason: expect.any(String) },
    ]);
    expect(states.checkState('a1')).toEqual({ failures: 0, errorSince: null, notified: false });
  });

  test('holds the messages while muted, and says it once the mute ends', async () => {
    const { evaluate, sent, states, alerts } = harness();
    alerts.setMute('a1', { at: 0, by: 'ada', until: 3 * minute + 1 }, 0);
    for (let minutes = 1; minutes <= 4; minutes += 1)
      await evaluate(minutes * minute, new Error('down'));
    expect(sent.map((each) => each.event)).toEqual(['alert.error']);
    expect(sent[0]?.at).toBe(new Date(4 * minute).toISOString());
    expect(states.checkEvents('a1', 10).map((each) => each.notified)).toEqual([true, false]);
  });

  test('records but sends nothing when the setting is off', async () => {
    const { evaluate, sent, states, setting } = harness();
    setting.notifyOnError = false;
    for (let minutes = 1; minutes <= 3; minutes += 1)
      await evaluate(minutes * minute, new Error('down'));
    await evaluate(4 * minute, at(1));
    expect(sent).toEqual([]);
    expect(states.checkEvents('a1', 10)).toMatchObject([
      { kind: 'recovered', notified: false },
      { kind: 'error', notified: false },
    ]);
  });

  test('resolves a firing series that leaves the result, after the grace period', async () => {
    const { evaluate, sent, states } = harness({
      condition: { kind: 'threshold', op: 'above', value: 5, for: '0m' },
    });
    const both = [...at(9), ...at(1, { service: 'cart' })];
    await evaluate(minute, both);
    const cartOnly = at(1, { service: 'cart' });
    for (let minutes = 2; minutes <= 3; minutes += 1) await evaluate(minutes * minute, cartOnly);
    expect(states.series('a1').find((row) => row.labels.service === 'checkout')?.state).toBe(
      'firing',
    );
    await evaluate(4 * minute, cartOnly);
    expect(states.series('a1').map((row) => row.labels.service)).toEqual(['cart']);
    expect(sent.map((each) => each.event)).toEqual(['alert.firing', 'alert.resolved']);
  });

  test('moves every known series to no_data on an empty result', async () => {
    const { evaluate, states } = harness();
    await evaluate(minute, at(1));
    await evaluate(2 * minute, []);
    expect(states.series('a1')[0]?.state).toBe('no_data');
  });

  test('keeps going when a channel fails', async () => {
    const { dependencies, states, alerts } = harness({
      condition: { kind: 'threshold', op: 'above', value: 5, for: '0m' },
    });
    const failing = { ...dependencies, notify: () => Promise.reject(new Error('Slack is down.')) };
    const alert = alerts.get('a1');
    if (!alert) throw new Error('no alert');
    const subject = {
      alert,
      spec: spec({ condition: { kind: 'threshold', op: 'above', value: 5, for: '0m' } }),
    };
    const engine = { ...failing, ...fakeEngine(() => at(9)) };
    await evaluateAlert(engine, subject, minute);
    expect(states.series('a1')[0]).toMatchObject({ state: 'firing', announced: true });
  });
});
