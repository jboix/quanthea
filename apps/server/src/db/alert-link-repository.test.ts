import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { temporaryDir } from '../test/fixtures.ts';
import { createAlertLinkRepository } from './alert-link-repository.ts';
import { createAlertRepository } from './alert-repository.ts';
import { openDatabase } from './database.ts';
import { runMigrations } from './migrate.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let database: Database;

beforeEach(() => {
  dataDir = temporaryDir();
  database = openDatabase(dataDir.path);
  runMigrations(database);
  const alerts = createAlertRepository(database);
  for (const alertId of ['a', 'b'])
    alerts.addVersion({
      alertId,
      title: alertId,
      spec: {},
      note: null,
      createdBy: 'ada',
      createdAt: 1,
    });
  for (const id of ['d', 'e'])
    database.run('INSERT INTO dashboards (id, title, created_at, updated_at) VALUES (?, ?, 1, 1)', [
      id,
      id,
    ]);
});

afterEach(() => {
  database.close();
  dataDir.remove();
});

/**
 * A link made by hand.
 *
 * @param alertId - The alert.
 * @param dashboardId - The dashboard.
 * @param panelId - The panel.
 * @returns The link.
 */
const link = (alertId: string, dashboardId: string, panelId: string) => ({
  alertId,
  dashboardId,
  panelId,
  createdBy: 'ada',
  createdAt: 2,
  how: 'by_hand' as const,
});

describe('the alert link repository', () => {
  test('adds a link once, lists it from both sides, and removes it', () => {
    const links = createAlertLinkRepository(database);
    expect(links.add(link('a', 'd', 'errors'))).toBe(true);
    expect(links.add({ ...link('a', 'd', 'errors'), how: 'agent' })).toBe(false);
    links.add(link('b', 'd', 'latency'));
    expect(links.forAlert('a')).toEqual([link('a', 'd', 'errors')]);
    expect(links.forDashboard('d').map((each) => each.alertId)).toEqual(['a', 'b']);
    expect(links.remove('a', { dashboardId: 'd', panelId: 'errors' })).toBe(true);
    expect(links.remove('a', { dashboardId: 'd', panelId: 'errors' })).toBe(false);
    expect(links.all()).toEqual([link('b', 'd', 'latency')]);
  });

  test('refuses a way of linking it does not know', () => {
    const links = createAlertLinkRepository(database);
    expect(() => links.add({ ...link('a', 'd', 'x'), how: 'magic' as never })).toThrow();
  });

  test('links and dismissals go with their alert or their dashboard', () => {
    const links = createAlertLinkRepository(database);
    links.add(link('a', 'd', 'errors'));
    links.add(link('b', 'e', 'errors'));
    links.dismiss({ alertId: 'a', dashboardId: 'e', panelId: 'errors' }, 'ada', 3);
    links.dismiss({ alertId: 'b', dashboardId: 'd', panelId: 'errors' }, 'ada', 3);
    database.run("DELETE FROM alerts WHERE id = 'a'");
    expect(links.all().map((each) => each.alertId)).toEqual(['b']);
    expect(links.dismissals()).toEqual([{ alertId: 'b', dashboardId: 'd', panelId: 'errors' }]);
    database.run("DELETE FROM dashboards WHERE id = 'e'");
    expect(links.all()).toEqual([]);
    database.run("DELETE FROM dashboards WHERE id = 'd'");
    expect(links.dismissals()).toEqual([]);
  });

  test('reads the changes into and out of firing up to a time', () => {
    const links = createAlertLinkRepository(database);
    const insert = (id: string, from: string, to: string, at: number) =>
      database.run(
        `INSERT INTO alert_events (id, alert_id, version, series_key, labels, from_state, to_state,
           at) VALUES (?, 'a', 1, 'k', '{"service":"api"}', ?, ?, ?)`,
        [id, from, to, at],
      );
    insert('1', 'ok', 'pending', 10);
    insert('2', 'pending', 'firing', 20);
    insert('3', 'firing', 'ok', 30);
    insert('4', 'ok', 'firing', 40);
    expect(links.firingChanges('a', 35)).toEqual([
      { seriesKey: 'k', labels: { service: 'api' }, started: true, at: 20 },
      { seriesKey: 'k', labels: { service: 'api' }, started: false, at: 30 },
    ]);
  });
});
