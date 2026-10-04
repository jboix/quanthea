import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { temporaryDir } from '../test/fixtures.ts';
import { createAlertChannelUsage } from './alert-channel-usage.ts';
import { createAlertRepository } from './alert-repository.ts';
import { createAlertStateRepository } from './alert-state-repository.ts';
import { openDatabase } from './database.ts';
import { runMigrations } from './migrate.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let database: Database;

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
 * A version to add to the alert `a`.
 *
 * @param title - The spec's title.
 * @param createdAt - When.
 * @returns The version.
 */
const version = (title: string, createdAt: number) => ({
  alertId: 'a',
  title,
  spec: { title },
  note: null,
  createdBy: 'ada',
  createdAt,
});

describe('the alert repository', () => {
  test('numbers versions, and takes its title from the active one', () => {
    const alerts = createAlertRepository(database);
    expect(alerts.addVersion(version('First', 1), null)).toBe(1);
    expect(alerts.addVersion(version('Second', 2))).toBe(2);
    expect(alerts.get('a')).toMatchObject({
      title: 'Second',
      activeVersion: null,
      latestVersion: 2,
    });
    expect(alerts.activate('a', 1, 3)).toBe(true);
    expect(alerts.activate('a', 7, 3)).toBe(false);
    alerts.addVersion(version('Third', 4));
    expect(alerts.get('a')).toMatchObject({ title: 'First', activeVersion: 1, latestVersion: 3 });
    expect(alerts.versions('a').map((each) => [each.version, each.activatedAt])).toEqual([
      [3, null],
      [2, null],
      [1, 3],
    ]);
  });

  test('lists the alerts evaluated: active and not deactivated', () => {
    const alerts = createAlertRepository(database);
    alerts.addVersion(version('First', 1));
    expect(alerts.evaluated()).toEqual([]);
    alerts.activate('a', 1, 2);
    expect(alerts.evaluated().map((each) => each.spec)).toEqual([{ title: 'First' }]);
    alerts.deactivate('a', 3);
    expect(alerts.evaluated()).toEqual([]);
    alerts.activate('a', 1, 4);
    expect(alerts.get('a')?.deactivatedAt).toBeNull();
  });

  test('counts the alerts whose active version lists a channel', () => {
    const alerts = createAlertRepository(database);
    const usage = createAlertChannelUsage(database);
    alerts.addVersion({ ...version('First', 1), spec: { title: 'First', channels: ['oncall'] } });
    expect(usage('oncall')).toBe(0);
    alerts.activate('a', 1, 2);
    expect([usage('oncall'), usage('other')]).toEqual([1, 0]);
    alerts.addVersion({ ...version('Second', 3), spec: { title: 'Second', channels: ['other'] } });
    expect([usage('oncall'), usage('other')]).toEqual([1, 0]);
  });

  test('mutes and unmutes', () => {
    const alerts = createAlertRepository(database);
    alerts.addVersion(version('First', 1));
    alerts.setMute('a', { at: 2, by: 'ada', until: null }, 2);
    expect(alerts.get('a')).toMatchObject({ mutedAt: 2, mutedBy: 'ada', mutedUntil: null });
    alerts.setMute('a', null, 3);
    expect(alerts.get('a')).toMatchObject({ mutedAt: null, mutedBy: null });
  });
});

describe('the alert state repository', () => {
  test('saves an evaluation, counts states and purges old changes', () => {
    createAlertRepository(database).addVersion(version('First', 1));
    const states = createAlertStateRepository(database);
    const row = {
      key: '{}',
      labels: {},
      state: 'firing' as const,
      since: 1,
      value: 2,
      lastSeenAt: 1,
      evaluatedAt: 1,
      notifiedAt: 1,
      announced: true,
    };
    const event = {
      id: 'e1',
      version: 1,
      seriesKey: '{}',
      labels: {},
      from: 'pending' as const,
      to: 'firing' as const,
      at: 1,
      value: 2,
      message: null,
      notified: true,
    };
    states.saveEvaluation('a', { evaluatedAt: 1, series: [row], removed: [], events: [event] });
    expect(states.series('a')).toEqual([row]);
    expect(states.stateCounts().get('a')).toEqual({ firing: 1 });
    const { id: _id, ...stored } = event;
    expect(states.events('a', 5)).toEqual([stored]);
    expect(createAlertRepository(database).get('a')?.evaluatedAt).toBe(1);
    expect(states.purgeEvents(1)).toBe(0);
    expect(states.purgeEvents(2)).toBe(1);
    states.saveEvaluation('a', { evaluatedAt: 2, series: [], removed: ['{}'], events: [] });
    expect(states.series('a')).toEqual([]);
  });
});
