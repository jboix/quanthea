/**
 * The migration that follows the last release, run on a database of that release holding real
 * rows: the upgrade keeps the data working.
 */
import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { temporaryDir } from '../test/fixtures.ts';
import { openDatabase } from './database.ts';
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
const released = ['0001-schema.sql', '0002-snapshots-questions-analyst.sql'];
const upgrade = '0003-version-trigger-and-layouts.sql';

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

/**
 * Applies the upgrade to a database of the last release.
 *
 * @param migrationsDir - The directory holding the released files.
 */
function upgradeDatabase(migrationsDir: string): void {
  copyFileSync(join(shipped, upgrade), join(migrationsDir, upgrade));
  expect(runMigrations(database, migrationsDir)).toEqual([upgrade]);
}

/** Stores the dashboard `d` with a pinned first version and a draft second one. */
function storeDashboard(): void {
  database.run(
    "INSERT INTO dashboards (id, title, created_at, updated_at) VALUES ('d', 'D', 0, 0)",
  );
  database.run(
    `INSERT INTO dashboard_versions (id, dashboard_id, version, spec, change_summary, actor,
       created_at) VALUES ('v1', 'd', 1, '{}', 'first', 'ada', 1), ('v2', 'd', 2, '{}', NULL,
       'ada', 2)`,
  );
  database.run("UPDATE dashboard_versions SET pinned_at = 3 WHERE id = 'v1'");
  database.run("UPDATE dashboards SET pinned_version_id = 'v1' WHERE id = 'd'");
}

/**
 * Reads the versions of the dashboard `d`.
 *
 * @returns Each version's number, summary, author and first pin time.
 */
function versions() {
  return database
    .query<Record<string, unknown>, []>(
      `SELECT version, change_summary, actor, pinned_at FROM dashboard_versions
       WHERE dashboard_id = 'd' ORDER BY version`,
    )
    .all();
}

describe('the dashboard versions after the upgrade', () => {
  test('keep every version and the one pinned', () => {
    const migrationsDir = releasedDatabase();
    storeDashboard();
    upgradeDatabase(migrationsDir);
    expect(versions()).toEqual([
      { version: 1, change_summary: 'first', actor: 'ada', pinned_at: 3 },
      { version: 2, change_summary: null, actor: 'ada', pinned_at: null },
    ]);
    const pinned = database.query<{ id: string }, []>(
      'SELECT pinned_version_id AS id FROM dashboards',
    );
    expect(pinned.get()).toEqual({ id: 'v1' });
  });

  test('refuse a change to any column but the first pin time', () => {
    const migrationsDir = releasedDatabase();
    storeDashboard();
    database.run("UPDATE dashboard_versions SET change_summary = 'before' WHERE id = 'v2'");
    upgradeDatabase(migrationsDir);
    for (const column of ['change_summary', 'actor', 'spec', 'id'])
      expect(() => database.run(`UPDATE dashboard_versions SET ${column} = 'x'`)).toThrow(
        'immutable',
      );
    expect(() => database.run('UPDATE dashboard_versions SET created_at = 9')).toThrow('immutable');
    database.run("UPDATE dashboard_versions SET pinned_at = 4 WHERE id = 'v2'");
    expect(versions()[1]).toMatchObject({ change_summary: 'before', pinned_at: 4 });
  });
});
