import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Notification } from '@quanthea/shared';
import { createAlertRepository } from '../db/alert-repository.ts';
import { createAlertStateRepository } from '../db/alert-state-repository.ts';
import { createAuditRepository } from '../db/audit-repository.ts';
import { openDatabase } from '../db/database.ts';
import { runMigrations } from '../db/migrate.ts';
import { captureLogs, temporaryDir } from '../test/fixtures.ts';
import { createAlerts } from './alerts.ts';
import { evaluateAlert } from './evaluate.ts';
import { fakeEngine, seriesFrame, specInput } from './test/fixtures.ts';

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

const guardrails = { timeoutMs: 1000, maxRows: 1000, maxRangeDays: 31 };

/** Fires at once above 5. */
const firesAtOnce = { condition: { kind: 'threshold', op: 'above', value: 5, for: '0m' } };

/**
 * The alerts service over a fake engine that always answers 9, with one channel, `oncall`.
 *
 * @returns The service, the notifications sent, the channels that exist, and an evaluation.
 */
function setup() {
  const sent: Notification[] = [];
  const channels = new Set(['oncall']);
  const engine = fakeEngine(() => [seriesFrame({ service: 'checkout' }, [[0, 9]])]);
  const states = createAlertStateRepository(database);
  const notify = (_ids: readonly string[], notification: Notification) => {
    sent.push(notification);
    return Promise.resolve();
  };
  const dependencies = {
    ...engine,
    states,
    notify,
    alertUrl: () => '/alerts/a',
    notifyOnError: () => true,
  };
  const alerts = createAlerts({
    ...dependencies,
    repository: createAlertRepository(database),
    audit: createAuditRepository(database),
    lookup: () => ({ language: 'promql', guardrails }),
    settings: { get: () => ({ maxActivePerConnector: 50, notifyOnError: true }) },
    channelExists: (id) => channels.has(id),
  });
  const evaluate = async () => {
    const [subject] = alerts.evaluated();
    const logger = captureLogs().logger;
    if (subject) await evaluateAlert({ ...dependencies, logger }, subject, Date.now());
  };
  return { alerts, sent, channels, states, evaluate };
}

describe('notification channels of an alert', () => {
  test('a version naming an unknown channel is refused on save', () => {
    const { alerts } = setup();
    expect(() => alerts.saveVersion({ spec: specInput({ channels: ['gone'] }) }, 'ada')).toThrow(
      'invalid',
    );
  });

  test('a version whose channel was deleted since is refused on activation', async () => {
    const { alerts, channels } = setup();
    const { alertId } = alerts.saveVersion({ spec: specInput() }, 'ada');
    channels.delete('oncall');
    await expect(alerts.activate(alertId, 1, 'ada')).rejects.toMatchObject({
      code: 'bad_request',
      details: [expect.objectContaining({ path: 'channels[0]' })],
    });
  });
});

describe('deactivating an alert', () => {
  test('resolves the series that announced firing, then ends them', async () => {
    const { alerts, sent, states, evaluate } = setup();
    const { alertId } = alerts.saveVersion({ spec: specInput(firesAtOnce) }, 'ada');
    await alerts.activate(alertId, 1, 'ada');
    await evaluate();
    expect(sent.map((each) => each.event)).toEqual(['alert.firing']);
    const summary = await alerts.deactivate(alertId, 'ada');
    expect(summary.deactivated).toBe(true);
    expect(sent.map((each) => each.event)).toEqual(['alert.firing', 'alert.resolved']);
    expect(sent[1]?.series.labels).toEqual({ service: 'checkout' });
    expect(states.series(alertId)).toEqual([]);
    expect(states.events(alertId, 1)[0]).toMatchObject({
      from: 'firing',
      to: 'ok',
      notified: true,
    });
  });

  test('sends nothing when the version does not notify resolving', async () => {
    const { alerts, sent, evaluate } = setup();
    const quiet = specInput({ ...firesAtOnce, notify: { onResolved: false } });
    const { alertId } = alerts.saveVersion({ spec: quiet }, 'ada');
    await alerts.activate(alertId, 1, 'ada');
    await evaluate();
    await alerts.deactivate(alertId, 'ada');
    expect(sent.map((each) => each.event)).toEqual(['alert.firing']);
  });
});

describe('a test notification', () => {
  test("sends the version's message as alert.test, filled from the series given", async () => {
    const { alerts, sent } = setup();
    const { alertId } = alerts.saveVersion({ spec: specInput() }, 'ada');
    const since = Date.UTC(2026, 9, 3, 14, 4);
    const series = { labels: { service: 'checkout' }, value: 7.5, since };
    await alerts.sendTest(alertId, 1, series, 'ada');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      event: 'alert.test',
      alert: { id: alertId, version: 1, severity: 'critical' },
      series: { labels: { service: 'checkout' } },
      values: {
        series: 'service=checkout',
        value: '7.5',
        threshold: 'above 5',
        since: '3 Oct, 14:04 UTC',
      },
    });
  });

  test('is refused for a version that notifies no channel', async () => {
    const { alerts } = setup();
    const { alertId } = alerts.saveVersion({ spec: specInput({ channels: [] }) }, 'ada');
    await expect(alerts.sendTest(alertId, 1, undefined, 'ada')).rejects.toMatchObject({
      code: 'bad_request',
    });
  });
});
