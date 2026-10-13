import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { temporaryDir } from '../test/fixtures.ts';
import { createDashboardRepository } from './dashboard-repository.ts';
import { openDatabase } from './database.ts';
import { createLayoutRepository, type NewLayout } from './layout-repository.ts';
import { runMigrations } from './migrate.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let database: Database;

const dashboardId = '01K0000000000000000000000D';

beforeEach(() => {
  dataDir = temporaryDir();
  database = openDatabase(dataDir.path);
  runMigrations(database);
  const dashboard = {
    id: dashboardId,
    title: 'Checkout incident',
    description: null,
    tags: [],
    parentDashboardId: null,
    parentVersion: null,
    pinnedVersionId: null,
    deletedAt: null,
    createdAt: 1000,
    updatedAt: 1000,
  };
  const version = {
    id: '01K0000000000000000000000V',
    dashboardId,
    version: 1,
    spec: { specVersion: 1, title: 'Checkout incident' },
    changeSummary: 'imported',
    pinnedAt: null,
    actor: 'admin-1',
    createdAt: 1000,
  };
  createDashboardRepository(database).create(dashboard, version);
});

afterEach(() => {
  database.close();
  dataDir.remove();
});

/**
 * A revision of version 1's layout.
 *
 * @param id - Its id.
 * @param hidden - Whether its one panel is hidden.
 * @returns The revision to add.
 */
function revision(id: string, hidden = false): NewLayout {
  const panels = [{ id: 'errors', grid: { x: 0, y: 0, w: 6, h: 3 }, hidden }];
  return {
    id,
    subjectId: dashboardId,
    version: 1,
    layout: { panels },
    restoredFrom: null,
    actor: 'admin-1',
    createdAt: 2000,
  };
}

describe('the layout repository', () => {
  test('numbers revisions per version and shows the latest', () => {
    const layouts = createLayoutRepository(database);
    expect(layouts.latest(dashboardId, 1)).toBeUndefined();
    expect(layouts.add(revision('L1'), null)?.revision).toBe(1);
    expect(layouts.add(revision('L2', true), 1)?.revision).toBe(2);
    expect(layouts.latest(dashboardId, 1)).toMatchObject({ id: 'L2', revision: 2 });
    expect(layouts.history(dashboardId, 1).map((row) => row.revision)).toEqual([2, 1]);
  });

  test('refuses a revision based on one that is no longer the latest', () => {
    const layouts = createLayoutRepository(database);
    layouts.add(revision('L1'), null);
    layouts.add(revision('L2'), 1);
    expect(layouts.add(revision('L3'), 1)).toBeUndefined();
    expect(layouts.add(revision('L4'), null)).toBeUndefined();
    expect(layouts.history(dashboardId, 1)).toHaveLength(2);
  });

  test('never rewrites a revision', () => {
    createLayoutRepository(database).add(revision('L1'), null);
    expect(() => database.run("UPDATE dashboard_layouts SET layout = '{}'")).toThrow(
      'dashboard layouts are immutable',
    );
  });

  test('keeps the layouts of reports apart, in their own table', () => {
    database.run(
      "INSERT INTO reports (id, title, created_by, created_at, updated_at) VALUES ('r', 'R', 'ada', 0, 0)",
    );
    database.run(
      `INSERT INTO report_versions (report_id, version, spec, created_by, created_at)
         VALUES ('r', 1, '{}', 'ada', 0)`,
    );
    const reports = createLayoutRepository(database, 'report');
    expect(reports.add({ ...revision('R1'), subjectId: 'r' }, null)).toMatchObject({
      subjectId: 'r',
      revision: 1,
    });
    expect(reports.latest('r', 1)).toMatchObject({ id: 'R1', subjectId: 'r', revision: 1 });
    expect(createLayoutRepository(database).latest('r', 1)).toBeUndefined();
    expect(() => database.run("UPDATE report_layouts SET layout = '{}'")).toThrow(
      'report layouts are immutable',
    );
    database.run("DELETE FROM reports WHERE id = 'r'");
    expect(database.query('SELECT count(*) AS n FROM report_layouts').get()).toEqual({ n: 0 });
  });

  test('goes with its dashboard', () => {
    createLayoutRepository(database).add(revision('L1'), null);
    database.run('DELETE FROM dashboards WHERE id = ?', [dashboardId]);
    expect(database.query('SELECT count(*) AS n FROM dashboard_layouts').get()).toEqual({ n: 0 });
  });
});
