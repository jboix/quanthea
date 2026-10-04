import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { temporaryDir } from '../test/fixtures.ts';
import { createAlertActivityRepository } from './alert-activity.ts';
import { createAuditRepository } from './audit-repository.ts';
import { createChannelRepository } from './channel-repository.ts';
import { openDatabase } from './database.ts';
import { runMigrations } from './migrate.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let database: Database;

beforeEach(() => {
  dataDir = temporaryDir();
  database = openDatabase(dataDir.path);
  runMigrations(database);
  const channels = createChannelRepository(database);
  for (const [id, name, kind] of [
    ['c1', '#oncall', 'slack'],
    ['c2', 'pager', 'pagerduty'],
  ] as const) {
    const at = 1;
    channels.save({
      ...{ id, name, kind, targetHint: 'hooks.slack.com/…/x', mentions: [], signed: false },
      ...{ secret: new Uint8Array([1]), createdBy: 'ada', createdAt: at, updatedAt: at },
      ...{ lastSentAt: null, lastError: null },
    });
  }
});

afterEach(() => {
  database.close();
  dataDir.remove();
});

/**
 * Logs a send.
 *
 * @param id - The send id, which orders sends at the same time.
 * @param channelId - The channel.
 * @param alertId - The alert.
 * @param at - When.
 * @param ok - Whether it got through.
 */
function send(id: string, channelId: string, alertId: string, at: number, ok = true): void {
  createChannelRepository(database).recordSend({
    ...{ id, channelId, event: 'alert.firing', alertId, seriesKey: '', at, ok },
    ...{ httpStatus: ok ? 200 : 500, attempts: 1, error: ok ? null : 'HTTP 500' },
  });
}

test('names channels by id, leaving out the ones that are gone, without their targets', () => {
  const activity = createAlertActivityRepository(database);
  expect(activity.channels(['c2', 'gone', 'c1'])).toEqual([
    { id: 'c2', name: 'pager', kind: 'pagerduty' },
    { id: 'c1', name: '#oncall', kind: 'slack' },
  ]);
});

test('lists the sends about an alert, and the latest about each alert', () => {
  send('s1', 'c1', 'a', 10);
  send('s2', 'c2', 'a', 20, false);
  send('s3', 'c1', 'b', 5);
  const activity = createAlertActivityRepository(database);
  expect(activity.sends('a', 10).map((each) => [each.channel, each.at, each.ok])).toEqual([
    ['pager', 20, false],
    ['#oncall', 10, true],
  ]);
  expect(activity.sends('a', 1)).toHaveLength(1);
  const latest = activity.lastSends();
  expect(latest.get('a')).toMatchObject({ channel: 'pager', kind: 'pagerduty', at: 20 });
  expect(latest.get('b')).toMatchObject({ channel: '#oncall', at: 5 });
  expect(latest.has('c')).toBe(false);
});

test('reads the audited changes of an alert, the latest first, and nothing else', () => {
  const audit = createAuditRepository(database);
  audit.append({ actor: 'ada', action: 'alert.version', target: 'a', detail: { version: 1 } });
  audit.append({ actor: 'ada', action: 'alert.activate', target: 'a', detail: { version: 1 } });
  audit.append({ actor: 'ana', action: 'alert.mute', target: 'a', detail: { until: null } });
  audit.append({ actor: 'ada', action: 'alert.deactivate', target: 'b' });
  const changes = createAlertActivityRepository(database).changes('a', 10);
  expect(changes.map((each) => [each.action, each.actor, each.detail])).toEqual([
    ['alert.mute', 'ana', { until: null }],
    ['alert.activate', 'ada', { version: 1 }],
  ]);
});
