/**
 * The migrations of every release, read from its git tag. A file a release shipped never changes,
 * and a database each release migrated upgrades to the schema a new install gets. The tags must be
 * fetched (CI checks out the whole history); without them the test fails rather than pass empty.
 */
import type { Database } from 'bun:sqlite';
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { temporaryDir } from '../test/fixtures.ts';
import { openDatabase } from './database.ts';
import { runMigrations } from './migrate.ts';

/** The migrations at HEAD. */
const shipped = join(import.meta.dir, 'migrations');

/** The repository's root: git runs there, since from a subdirectory it lists only that one. */
const repoRoot = join(import.meta.dir, '..', '..', '..', '..');

/** Where the migrations sit in the repository, as git names them. */
const repoPath = 'apps/server/src/db/migrations';

/**
 * The files a release changed after an earlier release had shipped them, each with why it is
 * allowed. A new entry here is a mistake to explain, never a way to edit a released migration.
 */
const knownChanges: Readonly<Record<string, string>> = {
  'v1.1.0:0004-quiet-hours-and-connector-visibility.sql':
    '1.1.0 added the definitions table to the 0004 of 1.0.0; 0004 is back to 1.0.0 and 0005 adds it.',
};

/** The tags no database upgrades from, each with why. */
const notUpgraded: Readonly<Record<string, string>> = {
  'v0.0.0': 'It came before the first release, whose migrations were squashed into one schema.',
};

/**
 * Runs git in the repository.
 *
 * @param args - The arguments.
 * @returns What it printed.
 */
function git(...args: string[]): string {
  const run = Bun.spawnSync(['git', ...args], { cwd: repoRoot });
  if (!run.success) throw new Error(`git ${args.join(' ')}: ${run.stderr.toString()}`);
  return run.stdout.toString();
}

/**
 * The release tags a database upgrades from, such as `v1.0.0`, oldest first.
 *
 * @returns The tags.
 */
function releaseTags(): string[] {
  const tags = git('tag', '--list', 'v*', '--sort=v:refname').split('\n');
  return tags.filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag) && !(tag in notUpgraded));
}

/**
 * The migration files of a release, by name.
 *
 * @param tag - The release's tag.
 * @returns Each file's SQL.
 */
function migrationsOf(tag: string): Map<string, string> {
  const names = git('ls-tree', '--name-only', `${tag}:${repoPath}`).split('\n');
  const files = names.filter((name) => name.endsWith('.sql'));
  return new Map(files.map((name) => [name, git('show', `${tag}:${repoPath}/${name}`)]));
}

/**
 * The schema of a database, as names and shapes rather than SQL text: a column added later reads
 * the same as one a new install creates with its table.
 *
 * @param database - The database.
 * @returns Each table's columns, indexes and the triggers, sorted.
 */
function schemaOf(database: Database): Record<string, unknown> {
  const objects = database
    .query<{ type: string; name: string; tbl_name: string }, []>(
      "SELECT type, name, tbl_name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all();
  const tables = objects.filter((each) => each.type === 'table');
  return {
    tables: Object.fromEntries(
      tables.map((table) => [
        table.name,
        database.query(`PRAGMA table_xinfo("${table.name}")`).all(),
      ]),
    ),
    others: objects.filter((each) => each.type !== 'table'),
  };
}

const releases = releaseTags();
const opened: { database: Database; remove: () => void }[] = [];

afterEach(() => {
  for (const each of opened.splice(0)) {
    each.database.close();
    each.remove();
  }
});

/**
 * A new database in a temporary directory, closed after the test.
 *
 * @returns The database and its directory.
 */
function newDatabase(): { database: Database; path: string } {
  const directory = temporaryDir();
  const database = openDatabase(directory.path);
  opened.push({ database, remove: directory.remove });
  return { database, path: directory.path };
}

/**
 * A database migrated by a release's own files, then by the files at HEAD.
 *
 * @param tag - The release.
 * @returns The upgraded database.
 */
function upgradedFrom(tag: string): Database {
  const { database, path } = newDatabase();
  const released = join(path, 'released-migrations');
  mkdirSync(released);
  for (const [name, sql] of migrationsOf(tag)) writeFileSync(join(released, name), sql);
  runMigrations(database, released);
  runMigrations(database, shipped);
  return database;
}

test('the release tags are fetched', () => {
  expect(releases.length).toBeGreaterThan(0);
});

describe.each(releases)('the migrations of %s', (tag) => {
  test('are unchanged at HEAD', () => {
    expect(migrationsOf(tag).size).toBeGreaterThan(0);
    const changed = [...migrationsOf(tag)]
      .filter(
        ([name, sql]) =>
          !readdirSync(shipped).includes(name) || readFileSync(join(shipped, name), 'utf8') !== sql,
      )
      .map(([name]) => `${tag}:${name}`)
      .filter((key) => !(key in knownChanges));
    expect(changed).toEqual([]);
  });

  test('upgrade a database to the schema of a new install', () => {
    const upgraded = upgradedFrom(tag);
    const { database: fresh } = newDatabase();
    runMigrations(fresh, shipped);
    expect(schemaOf(upgraded)).toEqual(schemaOf(fresh));
    expect(upgraded.query('PRAGMA integrity_check').all()).toEqual([{ integrity_check: 'ok' }]);
    expect(upgraded.query('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});
