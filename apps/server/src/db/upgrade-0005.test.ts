/**
 * The definitions migration, run on a database of each release that ran 0004: 1.0.0, whose 0004
 * had no definitions table, and 1.1.0, whose 0004 created it by mistake. Both end with the table, and its
 * versions can't be rewritten or removed.
 */
import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
const before = [
  '0001-schema.sql',
  '0002-snapshots-questions-analyst.sql',
  '0003-version-trigger-and-layouts.sql',
];
const fourth = '0004-quiet-hours-and-connector-visibility.sql';
const upgrade = '0005-definitions.sql';

/**
 * The fourth migration as 1.1.0 shipped it: the file of 1.0.0 with the definitions at its end.
 *
 * @returns The SQL.
 */
function fourthOfSecondRelease(): string {
  const read = (name: string) => readFileSync(join(shipped, name), 'utf8');
  return `${read(fourth)}\n${read(upgrade).replaceAll(' IF NOT EXISTS', '')}`;
}

/**
 * Builds a database that ran the first four migrations, then runs the fifth.
 *
 * @param fourthSql - The fourth migration as the release shipped it.
 * @returns The migrations the upgrade applied.
 */
function upgradeFrom(fourthSql: string): string[] {
  const migrationsDir = join(dataDir.path, 'migrations');
  mkdirSync(migrationsDir, { recursive: true });
  for (const name of before) copyFileSync(join(shipped, name), join(migrationsDir, name));
  writeFileSync(join(migrationsDir, fourth), fourthSql);
  runMigrations(database, migrationsDir);
  copyFileSync(join(shipped, upgrade), join(migrationsDir, upgrade));
  return runMigrations(database, migrationsDir);
}

/** Expects the definitions table to take a version and keep it as it is. */
function expectKeptVersions(): void {
  database.run("INSERT INTO definition_versions VALUES ('revenue', 1, '{}', 0, 'ui', 'ada', 1)");
  expect(() => database.run('UPDATE definition_versions SET actor = ?', ['bob'])).toThrow(
    'definition versions are immutable',
  );
  expect(() => database.run('DELETE FROM definition_versions')).toThrow(
    'definition versions are kept',
  );
}

test('a database of 1.0.0 gets the definitions table', () => {
  const sql = readFileSync(join(shipped, fourth), 'utf8');
  expect(sql).not.toContain('definition_versions');
  expect(upgradeFrom(sql)).toEqual([upgrade]);
  expectKeptVersions();
});

test('a database of 1.1.0, which has the table already, upgrades as well', () => {
  const sql = fourthOfSecondRelease();
  expect(sql).toContain('CREATE TABLE definition_versions');
  expect(upgradeFrom(sql)).toEqual([upgrade]);
  expectKeptVersions();
});
