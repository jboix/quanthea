import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { temporaryDir } from '../test/fixtures.ts';
import { createAlertPagesRepository, firstPage } from './alert-pages.ts';
import { createAlertRepository } from './alert-repository.ts';
import { createAlertStateRepository } from './alert-state-repository.ts';
import { createChannelRepository } from './channel-repository.ts';
import { openDatabase } from './database.ts';
import { runMigrations } from './migrate.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let database: Database;

beforeEach(() => {
  dataDir = temporaryDir();
  database = openDatabase(dataDir.path);
  runMigrations(database);
  for (const alertId of ['a', 'b'])
    createAlertRepository(database).addVersion({
      ...{ alertId, title: 'Errors', spec: {}, note: null, createdBy: 'ada', createdAt: 1 },
    });
});

afterEach(() => {
  database.close();
  dataDir.remove();
});

/**
 * Saves a change of state of an alert.
 *
 * @param id - Its id.
 * @param at - When.
 * @param quiet - Whether quiet hours held its notification back.
 * @param alertId - The alert.
 */
function event(id: string, at: number, quiet = false, alertId = 'a'): void {
  const change = { from: 'pending' as const, to: 'firing' as const, value: 2, message: null };
  const stored = { id, version: 1, seriesKey: '{}', labels: {}, at, notified: !quiet, quiet };
  createAlertStateRepository(database).saveEvaluation(alertId, {
    ...{ evaluatedAt: at, series: [], removed: [] },
    events: [{ ...stored, ...change }],
  });
}

/**
 * Saves a time an alert could not be checked.
 *
 * @param id - Its id.
 * @param at - When.
 * @param quiet - Whether quiet hours held its notification back.
 */
function check(id: string, at: number, quiet = false): void {
  const state = { failures: 3, errorSince: at, notified: !quiet };
  const stored = { id, kind: 'error' as const, at, reason: 'timeout', notified: !quiet, quiet };
  createAlertStateRepository(database).saveEvaluation('a', {
    ...{ evaluatedAt: at, series: [], removed: [], events: [] },
    check: { state, event: stored },
  });
}

/**
 * Writes an audit entry about an alert.
 *
 * @param id - Its id.
 * @param at - When.
 * @param action - The action.
 * @param target - The alert.
 */
function audited(id: string, at: number, action = 'alert.mute', target = 'a'): void {
  database
    .query(
      'INSERT INTO audit_log (id, at, actor, action, target, detail) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(id, at, 'ada', action, target, JSON.stringify({ until: null }));
}

/**
 * The ids of a page of the timeline of `a`.
 *
 * @param after - The cursor.
 * @param limit - The most to read.
 * @returns The ids, in order.
 */
function ids(after = firstPage, limit = 10): string[] {
  return createAlertPagesRepository(database)
    .timeline('a', after, limit)
    .map((each) => each.id);
}

describe('what happened to an alert, by page', () => {
  test('merges changes of state, check events and what people did, the latest first', () => {
    event('e1', 10);
    check('c1', 30, true);
    audited('m1', 20);
    event('e2', 40, true);
    event('other', 50, false, 'b');
    audited('v1', 60, 'alert.version');
    audited('m2', 70, 'alert.mute', 'b');
    const pages = createAlertPagesRepository(database);
    const rows = pages.timeline('a', firstPage, 10);
    expect(rows.map((each) => [each.type, each.id, each.at])).toEqual([
      ['event', 'e2', 40],
      ['check', 'c1', 30],
      ['change', 'm1', 20],
      ['event', 'e1', 10],
    ]);
    expect(rows[0]).toMatchObject({ to: 'firing', notified: false, quiet: true });
    expect(rows[1]).toMatchObject({ kind: 'error', reason: 'timeout', quiet: true });
    expect(rows[2]).toMatchObject({ action: 'alert.mute', actor: 'ada', detail: { until: null } });
    expect(rows[3]).toMatchObject({ notified: true, quiet: false });
    expect(pages.timelineCount('a', firstPage)).toBe(4);
  });

  test('reads the entries after a cursor, by id within one instant, to the end', () => {
    for (const id of ['e1', 'e2', 'e3']) event(id, 10);
    check('c1', 10);
    audited('m1', 10);
    event('e0', 5);
    expect(ids(firstPage, 2)).toEqual(['m1', 'e3']);
    expect(ids({ at: 10, id: 'e3' }, 2)).toEqual(['e2', 'e1']);
    expect(ids({ at: 10, id: 'e1' }, 2)).toEqual(['c1', 'e0']);
    expect(ids({ at: 5, id: 'e0' }, 2)).toEqual([]);
    const pages = createAlertPagesRepository(database);
    expect(pages.timelineCount('a', { at: 10, id: 'e3' })).toBe(4);
    expect(pages.timelineCount('a', { at: 5, id: 'e0' })).toBe(0);
  });

  test('a page after a cursor is the same once newer entries arrive', () => {
    for (const [id, at] of [
      ['e1', 10],
      ['e2', 20],
      ['e3', 30],
    ] as const)
      event(id, at);
    const cursor = { at: 30, id: 'e3' };
    const before = ids(cursor, 2);
    event('e4', 40);
    check('c2', 40);
    audited('m2', 41);
    expect(ids(cursor, 2)).toEqual(before);
    expect(ids(firstPage, 2)).toEqual(['m2', 'e4']);
  });
});

describe('the messages sent about an alert, by page', () => {
  /**
   * Logs a send to a channel made for it.
   *
   * @param id - The send id.
   * @param at - When.
   * @param alertId - The alert.
   */
  function send(id: string, at: number, alertId = 'a'): void {
    const channels = createChannelRepository(database);
    if (!channels.get('c1'))
      channels.save({
        ...{ id: 'c1', name: '#oncall', kind: 'slack', targetHint: 'x', mentions: [] },
        ...{ signed: false, secret: new Uint8Array([1]), createdBy: 'ada', createdAt: 1 },
        ...{ updatedAt: 1, lastSentAt: null, lastError: null },
      });
    channels.recordSend({
      ...{ id, channelId: 'c1', event: 'alert.firing', alertId, reportId: null, seriesKey: '' },
      ...{ at, ok: true, httpStatus: 200, attempts: 1, error: null },
    });
  }

  test('reads the sends after a cursor, the latest first, and counts them', () => {
    for (const [id, at] of [
      ['s1', 10],
      ['s2', 20],
      ['s3', 20],
      ['s4', 30],
    ] as const)
      send(id, at);
    send('other', 40, 'b');
    const pages = createAlertPagesRepository(database);
    const first = pages.sends('a', firstPage, 2);
    expect(first.map((each) => each.id)).toEqual(['s4', 's3']);
    expect(first[0]).toMatchObject({ channel: '#oncall', kind: 'slack', at: 30, ok: true });
    const cursor = { at: 20, id: 's3' };
    expect(pages.sends('a', cursor, 2).map((each) => each.id)).toEqual(['s2', 's1']);
    send('s5', 50);
    expect(pages.sends('a', cursor, 2).map((each) => each.id)).toEqual(['s2', 's1']);
    expect(pages.sendCount('a', firstPage)).toBe(5);
    expect(pages.sendCount('a', cursor)).toBe(2);
    expect(pages.sends('a', { at: 10, id: 's1' }, 2)).toEqual([]);
  });
});
