import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { temporaryDir } from '../test/fixtures.ts';
import { openDatabase } from './database.ts';
import { runMigrations } from './migrate.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let database: Database;

beforeEach(() => {
  dataDir = temporaryDir();
  database = openDatabase(join(dataDir.path, 'nested', 'data'));
});

afterEach(() => {
  database.close();
  dataDir.remove();
});

/**
 * Reads a single pragma value.
 *
 * @param name - The pragma name.
 * @returns Its current value.
 */
function pragma(name: string): unknown {
  const row = database.query<Record<string, unknown>, []>(`PRAGMA ${name}`).get();
  return row ? Object.values(row)[0] : undefined;
}

/**
 * Lists the user tables of the database.
 *
 * @returns Table names, sorted.
 */
function tableNames(): string[] {
  return database
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((row) => row.name);
}

describe('openDatabase', () => {
  test('creates the data directory with mode 0700', () => {
    expect(statSync(join(dataDir.path, 'nested', 'data')).mode & 0o777).toBe(0o700);
  });

  test('enables WAL, foreign keys and a busy timeout', () => {
    expect(pragma('journal_mode')).toBe('wal');
    expect(pragma('foreign_keys')).toBe(1);
    expect(pragma('busy_timeout')).toBe(5000);
  });
});

describe('runMigrations', () => {
  test('applies the shipped migrations once', () => {
    expect(runMigrations(database)).toEqual([
      '0001-settings-and-audit-log.sql',
      '0002-connectors.sql',
      '0003-dashboards.sql',
      '0004-threads.sql',
      '0005-usage.sql',
      '0006-thread-provider.sql',
      '0007-thread-recipes.sql',
      '0008-library-search.sql',
      '0009-every-version-is-immutable.sql',
      '0010-thread-bin.sql',
      '0011-users-and-sessions.sql',
      '0012-password-links.sql',
      '0013-identities.sql',
      '0014-provisioned.sql',
      '0015-user-setup.sql',
      '0016-usage-user.sql',
    ]);
    expect(runMigrations(database)).toEqual([]);
    expect(tableNames()).toEqual([
      'audit_log',
      'connectors',
      'dashboard_versions',
      'dashboards',
      'identities',
      'library_fts',
      'library_fts_config',
      'library_fts_content',
      'library_fts_data',
      'library_fts_docsize',
      'library_fts_idx',
      'messages',
      'migrations',
      'password_links',
      'plans',
      'provisioned',
      'schema_cache',
      'sessions',
      'settings',
      'threads',
      'usage_events',
      'users',
    ]);
  });

  test('rolls back a failing migration and keeps the ones before it', () => {
    const migrationsDir = join(dataDir.path, 'migrations');
    mkdirSync(migrationsDir);
    writeFileSync(join(migrationsDir, '0001-good.sql'), 'CREATE TABLE good (id TEXT);');
    writeFileSync(
      join(migrationsDir, '0002-bad.sql'),
      'CREATE TABLE half_done (id TEXT); SELECT * FROM missing_table;',
    );
    expect(() => runMigrations(database, migrationsDir)).toThrow('missing_table');
    expect(tableNames()).toEqual(['good', 'migrations']);
  });
});
