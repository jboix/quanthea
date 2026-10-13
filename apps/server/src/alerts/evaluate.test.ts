import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { DefaultQuietHours, Frame, Notification } from '@quanthea/shared';
import { createAlertRepository } from '../db/alert-repository.ts';
import { createAlertStateRepository } from '../db/alert-state-repository.ts';
import { openDatabase } from '../db/database.ts';
import { runMigrations } from '../db/migrate.ts';
import { captureLogs, temporaryDir } from '../test/fixtures.ts';
import { evaluateAlert } from './evaluate.ts';
import {
  type FakeAnswer,
  fakeEngine,
  frameOf,
  minute,
  seriesFrame,
  spec,
} from './test/fixtures.ts';

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
  let answer: FakeAnswer | Parameters<typeof fakeEngine>[0] = [];
  const engine = fakeEngine((request) => (typeof answer === 'function' ? answer(request) : answer));
  const sent: Notification[] = [];
  const logs = captureLogs();
  const notify = (_channels: readonly string[], notification: Notification) => {
    sent.push(notification);
    return Promise.resolve();
  };
  const setting = { notifyOnError: true, quietHours: null as DefaultQuietHours | null };
  const dependencies = {
    ...engine,
    states,
    notify,
    logger: logs.logger,
    alertUrl: () => '/alerts/a1',
    notifyOnError: () => setting.notifyOnError,
    quietHours: () => setting.quietHours,
  };
  const evaluate = async (now: number, next: typeof answer) => {
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
  test('fires on a change within the window, and names how far it moved', async () => {
    const { evaluate, sent, states } = harness({
      condition: {
        kind: 'change',
        direction: 'down',
        amount: 50,
        unit: 'percent',
        within: '10m',
        for: '0m',
      },
      lookback: '20m',
      message: { title: '{alert}', body: '{series} went {change}, from {previous} to {value}.' },
    });
    const labels = { service: 'checkout' };
    // Too little history: the value is known, nothing is compared.
    await evaluate(5 * minute, [seriesFrame(labels, [[5 * minute, 100]])]);
    expect(states.series('a1')[0]).toMatchObject({ state: 'ok', value: 100 });
    const halved: [number, number][] = [
      [5 * minute, 100],
      [16 * minute, 48],
    ];
    await evaluate(16 * minute, [seriesFrame(labels, halved)]);
    expect(states.series('a1')[0]).toMatchObject({ state: 'firing', value: 48 });
    expect(sent.map((each) => each.event)).toEqual(['alert.firing']);
    expect(sent[0]?.values).toMatchObject({
      value: '48',
      change: '-52%',
      previous: '100',
      threshold: 'down 50% or more within 10m',
    });
    // The earlier point caught up: it resolves, though the value stayed.
    const stayed: [number, number][] = [
      [16 * minute, 48],
      [27 * minute, 48],
    ];
    await evaluate(27 * minute, [seriesFrame(labels, stayed)]);
    expect(states.series('a1')[0]).toMatchObject({ state: 'ok', value: 48 });
  });

  test('fires against the same window a week earlier, with a query for then', async () => {
    const week = 7 * 24 * 60 * minute;
    const { evaluate, sent, states, dependencies } = harness({
      condition: {
        kind: 'past',
        direction: 'up',
        amount: 30,
        unit: 'percent',
        ago: '7d',
        for: '0m',
      },
      message: { title: '{alert}', body: '{series}: {value}, {change} on {previous}.' },
    });
    const labels = { service: 'checkout' };
    const now = 2 * week;
    const thenAndNow =
      (then: number, value: number): Parameters<typeof fakeEngine>[0] =>
      ({ timeRange }) =>
        timeRange.to.getTime() === now
          ? [seriesFrame(labels, [[now, value]]), seriesFrame({ service: 'new' }, [[now, 900]])]
          : [seriesFrame(labels, [[now - week, then]])];
    await evaluate(now, thenAndNow(100, 120));
    expect(dependencies.requests).toHaveLength(2);
    expect(states.series('a1').map((each) => each.state)).toEqual(['ok', 'ok']);
    await evaluate(now, thenAndNow(100, 140));
    // The series that was not there a week earlier is watched, and never compared.
    expect(states.series('a1').map((each) => [each.key, each.state])).toEqual([
      ['{service="checkout"}', 'firing'],
      ['{service="new"}', 'ok'],
    ]);
    expect(sent.map((each) => each.event)).toEqual(['alert.firing']);
    expect(sent[0]?.values).toMatchObject({
      value: '140',
      change: '+40%',
      previous: '100',
      threshold: 'up 30% or more from a week earlier',
    });
  });

  test('fires outside the band of its history, and never without enough of it', async () => {
    const hour = 60 * minute;
    const { evaluate, sent, states } = harness({
      condition: { kind: 'band', side: 'either', deviations: 3, baseline: '1h', for: '0m' },
      message: { title: '{alert}', body: '{series}: {value} is outside {band}.' },
    });
    const labels = { service: 'checkout' };
    const now = 2 * hour;
    const history = (count: number): [number, number][] =>
      Array.from({ length: count }, (_, index) => [
        now - 10 * minute - index * minute,
        index % 2 === 0 ? 9 : 11,
      ]);
    const withHistory =
      (count: number, value: number): Parameters<typeof fakeEngine>[0] =>
      ({ timeRange }) =>
        timeRange.to.getTime() === now
          ? [seriesFrame(labels, [[now, value]])]
          : [seriesFrame(labels, history(count))];
    await evaluate(now, withHistory(5, 40));
    expect(states.series('a1')[0]).toMatchObject({ state: 'ok', value: 40 });
    await evaluate(now, withHistory(60, 12));
    expect(states.series('a1')[0]).toMatchObject({ state: 'ok', value: 12 });
    await evaluate(now, withHistory(60, 14));
    expect(states.series('a1')[0]).toMatchObject({ state: 'firing', value: 14 });
    expect(sent[0]?.values).toMatchObject({
      value: '14',
      band: '7 to 13',
      threshold: 'more than 3 deviations from its mean of the last 1h',
    });
  });

  test('cannot be checked when the query for its history fails', async () => {
    const { evaluate, states } = harness({
      condition: { kind: 'band', side: 'either', deviations: 3, baseline: '1h', for: '0m' },
    });
    const failing: Parameters<typeof fakeEngine>[0] = ({ timeRange }) =>
      timeRange.to.getTime() === 0 ? at(9) : new Error('Too far back.');
    await evaluate(0, failing);
    expect(states.series('a1')).toMatchObject([{ key: '', state: 'error' }]);
  });

  test('fires on joined tests of two columns, and names every value', async () => {
    const { evaluate, sent } = harness({
      value: { field: 'share', by: ['service'], format: { $fmt: 'percent', decimals: 1 } },
      condition: {
        kind: 'all',
        of: [
          { kind: 'threshold', op: 'above', value: 0.02 },
          {
            kind: 'threshold',
            op: 'above',
            value: 100,
            field: 'requests',
            format: { $fmt: 'number' },
          },
        ],
        for: '0m',
      },
      message: { title: '{alert}', body: '{series}: {values}, {threshold}.' },
    });
    const fields = [
      { name: 'service', type: 'string' as const },
      { name: 'share', type: 'number' as const },
      { name: 'requests', type: 'number' as const },
    ];
    await evaluate(minute, [
      frameOf(fields, [
        ['cart', 'checkout'],
        [0.05, 0.05],
        [40, 312],
      ]),
    ]);
    expect(sent.map((each) => each.series.labels.service)).toEqual(['checkout']);
    expect(sent[0]?.values).toMatchObject({
      value: '5%',
      values: '5%, requests 312',
      threshold: 'above 2% and requests above 100',
    });
  });

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

/**
 * Quiet hours on the first day of the epoch, a Thursday, in UTC.
 *
 * @param from - When they start, `HH:MM`.
 * @param to - When they end, `HH:MM`.
 * @returns The quiet hours.
 */
const thursday = (from: string, to: string) => ({
  timezone: 'UTC',
  windows: [{ days: ['thursday' as const], from, to }],
});

/** A condition that fires at once. */
const atOnce = { kind: 'threshold', op: 'above', value: 5, for: '0m' };

describe('quiet hours', () => {
  test('keep the history and send nothing, then announce what still fires, since when', async () => {
    const message = { title: '{alert} fires', body: '{value} is {threshold}.' };
    const { evaluate, sent, states, setting } = harness({
      condition: atOnce,
      severity: 'warning',
      message,
    });
    setting.quietHours = { ...thursday('00:00', '00:05'), exceptSeverities: ['critical'] };
    for (let minutes = 1; minutes <= 4; minutes += 1) await evaluate(minutes * minute, at(9));
    expect(sent).toEqual([]);
    expect(states.series('a1')[0]).toMatchObject({ state: 'firing', announced: false });
    expect(states.events('a1', 10)).toMatchObject([
      { to: 'firing', at: minute, notified: false, quiet: true },
    ]);
    await evaluate(5 * minute, at(9));
    await evaluate(6 * minute, at(9));
    expect(sent.map((each) => [each.event, each.at])).toEqual([
      ['alert.firing', new Date(5 * minute).toISOString()],
    ]);
    expect(sent[0]?.values.since).toBe('1 Jan, 00:01 UTC');
    expect(sent[0]?.template.fields).toEqual([{ label: 'Firing since', value: '{since}' }]);
  });

  test('send nothing for a series that fired and resolved inside them', async () => {
    const { evaluate, sent, states } = harness({
      condition: atOnce,
      quietHours: thursday('00:00', '00:05'),
    });
    await evaluate(minute, at(9));
    await evaluate(2 * minute, at(1));
    for (let minutes = 5; minutes <= 6; minutes += 1) await evaluate(minutes * minute, at(1));
    expect(sent).toEqual([]);
    expect(states.events('a1', 10).map((event) => [event.to, event.notified])).toEqual([
      ['ok', false],
      ['firing', false],
    ]);
  });

  test('of the settings leave a severity alone', async () => {
    const { evaluate, sent, setting } = harness({ condition: atOnce });
    setting.quietHours = { ...thursday('00:00', '00:00'), exceptSeverities: ['critical'] };
    await evaluate(minute, at(9));
    expect(sent).toHaveLength(1);
  });

  test('of the settings do not hold for an alert that sets none', async () => {
    const { evaluate, sent, setting } = harness({
      condition: atOnce,
      severity: 'info',
      quietHours: 'none',
    });
    setting.quietHours = { ...thursday('00:00', '00:00'), exceptSeverities: [] };
    await evaluate(minute, at(9));
    expect(sent).toHaveLength(1);
  });

  test('of an alert hold whatever its severity', async () => {
    const { evaluate, sent } = harness({
      condition: atOnce,
      quietHours: thursday('00:00', '00:05'),
    });
    await evaluate(minute, at(9));
    expect(sent).toEqual([]);
  });

  test('hold a resolution back until they end, for a series that is gone too', async () => {
    const { evaluate, sent, states } = harness({
      condition: atOnce,
      quietHours: thursday('00:02', '00:10'),
    });
    await evaluate(minute, [...at(9), ...at(9, { service: 'cart' })]);
    for (let minutes = 2; minutes <= 9; minutes += 1)
      await evaluate(minutes * minute, at(1, { service: 'cart' }));
    expect(sent.map((each) => each.event)).toEqual(['alert.firing', 'alert.firing']);
    expect(states.series('a1')).toMatchObject([
      { labels: { service: 'cart' }, state: 'ok', announced: true },
      { labels: { service: 'checkout' }, state: 'ok', announced: true },
    ]);
    expect(states.events('a1', 10).filter((event) => event.to === 'ok')).toHaveLength(2);
    await evaluate(10 * minute, at(1, { service: 'cart' }));
    expect(sent.slice(2).map((each) => [each.event, each.values.series])).toEqual([
      ['alert.resolved', 'service=cart'],
      ['alert.resolved', 'service=checkout'],
    ]);
    expect(states.series('a1').map((row) => [row.labels.service, row.announced])).toEqual([
      ['cart', false],
    ]);
  });

  test('hold back that an alert cannot be checked until they end', async () => {
    const { evaluate, sent } = harness({ quietHours: thursday('00:00', '00:04') });
    for (let minutes = 1; minutes <= 5; minutes += 1)
      await evaluate(minutes * minute, new Error('down'));
    expect(sent.map((each) => [each.event, each.at])).toEqual([
      ['alert.error', new Date(4 * minute).toISOString()],
    ]);
  });
});
