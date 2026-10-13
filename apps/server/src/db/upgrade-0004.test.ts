/**
 * The migration that follows the last release, run on a database of that release holding real
 * rows: the upgrade keeps the data working. An alert's history is kept, and none of it says quiet
 * hours held a notification back. A report and the layouts of dashboards are kept, and the
 * report's active version can be arranged.
 */
import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ObjectVisibility } from '@quanthea/shared';
import { checkScope } from '../query/scope/check.ts';
import { restricts, scopeOf } from '../query/scope/object-scope.ts';
import { temporaryDir } from '../test/fixtures.ts';
import { createAlertStateRepository } from './alert-state-repository.ts';
import { createConnectorRepository } from './connector-repository.ts';
import { openDatabase } from './database.ts';
import { createLayoutRepository } from './layout-repository.ts';
import { runMigrations } from './migrate.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let database: Database;

beforeEach(() => {
  dataDir = temporaryDir();
  database = openDatabase(dataDir.path);
});

afterEach(() => {
  database.close();
  dataDir.remove();
});

const shipped = join(import.meta.dir, 'migrations');
const released = [
  '0001-schema.sql',
  '0002-snapshots-questions-analyst.sql',
  '0003-version-trigger-and-layouts.sql',
];
const upgrade = '0004-quiet-hours-and-connector-visibility.sql';

/** The visibility of a new connector. */
const hidesSystem: ObjectVisibility = { showSystem: false, mode: 'except', names: [] };

/**
 * Builds a database at the schema of the last release.
 *
 * @returns The directory the released files were copied to, to add the upgrade.
 */
function releasedDatabase(): string {
  const migrationsDir = join(dataDir.path, 'migrations');
  mkdirSync(migrationsDir, { recursive: true });
  for (const name of released) copyFileSync(join(shipped, name), join(migrationsDir, name));
  runMigrations(database, migrationsDir);
  return migrationsDir;
}

/** Stores the alert `a` with a change of state that notified and a time it went into error. */
function storeHistory(): void {
  database.run(
    "INSERT INTO alerts (id, title, created_by, created_at, updated_at) VALUES ('a', 'A', 'ada', 0, 0)",
  );
  database.run(
    `INSERT INTO alert_events (id, alert_id, version, series_key, labels, from_state, to_state, at,
       value, message, notified) VALUES ('e', 'a', 1, '{}', '{}', 'pending', 'firing', 5, 2, NULL, 1)`,
  );
  database.run(
    `INSERT INTO alert_check_events (id, alert_id, kind, at, reason, notified)
       VALUES ('c', 'a', 'error', 6, 'timeout', 0)`,
  );
}

test('an alert keeps its history, with nothing held back by quiet hours', () => {
  const migrationsDir = releasedDatabase();
  storeHistory();
  copyFileSync(join(shipped, upgrade), join(migrationsDir, upgrade));
  expect(runMigrations(database, migrationsDir)).toEqual([upgrade]);
  const states = createAlertStateRepository(database);
  expect(states.events('a', 5)).toMatchObject([
    { to: 'firing', at: 5, notified: true, quiet: false },
  ]);
  expect(states.checkEvents('a', 5)).toEqual([
    { kind: 'error', at: 6, reason: 'timeout', notified: false, quiet: false },
  ]);
});

/** The columns and values of a connector row of the last release, but for its id, name and kind. */
const settings = `config, secret, access_level, hidden_fields, guardrails, descriptions, created_at,
  updated_at) VALUES (?, ?, ?, '{"url":"http://search:9200"}', x'0102', 3, '["logs.user.email"]',
  '{"timeoutMs":5000,"maxRows":100,"maxRangeDays":7}', '{}', 1, 2)`;

/**
 * Inserts a connector as the last release did, without a visibility.
 *
 * @param id - Its id.
 * @param name - Its name.
 * @param kind - Its kind.
 */
function insertConnector(id: string, name: string, kind: string): void {
  database.run(`INSERT INTO connectors (id, name, kind, ${settings}`, [id, name, kind]);
}

/**
 * Upgrades a database of the last release that holds a search and a SQL connector.
 *
 * @returns The connectors.
 */
function upgraded(): ReturnType<typeof createConnectorRepository> {
  const migrationsDir = releasedDatabase();
  insertConnector('c1', 'logs', 'opensearch');
  insertConnector('c2', 'orders', 'postgres');
  copyFileSync(join(shipped, upgrade), join(migrationsDir, upgrade));
  expect(runMigrations(database, migrationsDir)).toEqual([upgrade]);
  return createConnectorRepository(database);
}

describe('the connectors after the upgrade', () => {
  test('keep their settings and show everything, system objects included', () => {
    const repository = upgraded();
    expect(repository.get('c1')).toMatchObject({
      name: 'logs',
      accessLevel: 3,
      hiddenFields: ['logs.user.email'],
      guardrails: { timeoutMs: 5000, maxRows: 100, maxRangeDays: 7 },
      visibility: { showSystem: true, mode: 'except', names: [] },
    });
    expect(repository.get('c2')?.visibility).toEqual({
      showSystem: true,
      mode: 'except',
      names: [],
    });
  });

  test('keep their stored queries running: nothing is checked or resolved', () => {
    const repository = upgraded();
    const search = scopeOf(repository.get('c1')?.visibility ?? hidesSystem, 'search');
    const sql = scopeOf(repository.get('c2')?.visibility ?? hidesSystem, 'sql', 'postgres');
    expect(restricts(search)).toBe(false);
    expect(restricts(sql)).toBe(false);
    const catalogRead = {
      language: 'sql',
      text: 'SELECT * FROM pg_catalog.pg_class',
      parameters: [],
    } as const;
    expect(() => checkScope(sql, catalogRead, 'postgres')).not.toThrow();
    expect(() =>
      checkScope(search, { language: 'search', index: '.kibana', body: {} }),
    ).not.toThrow();
    expect(() => checkScope(scopeOf(hidesSystem, 'sql', 'postgres'), catalogRead)).toThrow();
  });

  test('a connector made after it hides system objects by default', () => {
    const repository = upgraded();
    insertConnector('c3', 'new', 'postgres');
    expect(repository.get('c3')?.visibility).toEqual(hidesSystem);
  });
});

/** Stores the report `r` with an active version, as the last release did. */
function storeReport(): void {
  database.run(
    "INSERT INTO reports (id, title, created_by, created_at, updated_at) VALUES ('r', 'R', 'ada', 0, 0)",
  );
  database.run(
    `INSERT INTO report_versions (report_id, version, spec, created_by, created_at, activated_at)
       VALUES ('r', 1, '{"title":"R"}', 'ada', 0, 1)`,
  );
  database.run("UPDATE reports SET active_version = 1 WHERE id = 'r'");
}

/** Stores the dashboard `d` with a version arranged once, as the last release did. */
function storeArrangedDashboard(): void {
  database.run(
    "INSERT INTO dashboards (id, title, created_at, updated_at) VALUES ('d', 'D', 0, 0)",
  );
  database.run(
    `INSERT INTO dashboard_versions (id, dashboard_id, version, spec, change_summary, actor,
       created_at) VALUES ('v', 'd', 1, '{}', 'first', 'ada', 0)`,
  );
  database.run(
    `INSERT INTO dashboard_layouts (id, dashboard_id, version, revision, layout, actor, created_at)
       VALUES ('l', 'd', 1, 1, '{"panels":[]}', 'ada', 2)`,
  );
}

test('a report keeps its versions and takes a layout; a dashboard keeps its own', () => {
  const migrationsDir = releasedDatabase();
  storeReport();
  storeArrangedDashboard();
  copyFileSync(join(shipped, upgrade), join(migrationsDir, upgrade));
  expect(runMigrations(database, migrationsDir)).toEqual([upgrade]);
  const reports = createLayoutRepository(database, 'report');
  expect(reports.latest('r', 1)).toBeUndefined();
  const row = { id: 'n', subjectId: 'r', version: 1, layout: { panels: [] }, restoredFrom: null };
  expect(reports.add({ ...row, actor: 'ada', createdAt: 3 }, null)?.revision).toBe(1);
  expect(createLayoutRepository(database).latest('d', 1)).toMatchObject({
    id: 'l',
    subjectId: 'd',
    revision: 1,
    layout: { panels: [] },
  });
});
