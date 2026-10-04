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
      '0001-schema.sql',
      '0002-snapshots-questions-analyst.sql',
    ]);
    expect(runMigrations(database)).toEqual([]);
    expect(tableNames()).toEqual([
      'audit_log',
      'connectors',
      'dashboard_questions',
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
      'notification_channels',
      'notification_sends',
      'panel_explanations',
      'password_links',
      'plans',
      'provisioned',
      'question_fts',
      'question_fts_config',
      'question_fts_content',
      'question_fts_data',
      'question_fts_docsize',
      'question_fts_idx',
      'schema_cache',
      'sessions',
      'settings',
      'snapshots',
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

  test('rolls back a migration that leaves a broken reference, and keeps foreign keys on', () => {
    const migrationsDir = join(dataDir.path, 'migrations');
    mkdirSync(migrationsDir);
    writeFileSync(
      join(migrationsDir, '0001-broken.sql'),
      `CREATE TABLE parent (id TEXT PRIMARY KEY);
       CREATE TABLE child (parent_id TEXT REFERENCES parent (id));
       INSERT INTO child VALUES ('nobody');`,
    );
    expect(() => runMigrations(database, migrationsDir)).toThrow('breaks foreign keys');
    expect(tableNames()).toEqual(['migrations']);
    expect(pragma('foreign_keys')).toBe(1);
  });

  test('turns foreign keys back on after the migrations', () => {
    runMigrations(database);
    expect(pragma('foreign_keys')).toBe(1);
  });
});

describe('the library index', () => {
  test('holds the text of every query language a pinned panel runs', () => {
    runMigrations(database);
    const panel = (id: string, query: Record<string, unknown>) => ({
      id,
      title: id,
      queries: [{ refId: 'A', connector: 'logs', ...query }],
    });
    const spec = {
      panels: [
        panel('lines', { language: 'logql', expr: '{app="checkout"} |= "timeout"' }),
        panel('hits', { language: 'search', index: 'logs-*', body: { query: { match_all: {} } } }),
      ],
    };
    database.run(
      "INSERT INTO dashboards (id, title, created_at, updated_at) VALUES ('d', 'Logs', 0, 0)",
    );
    database.run(
      "INSERT INTO dashboard_versions (id, dashboard_id, version, spec, created_at) VALUES ('v', 'd', 1, ?, 0)",
      [JSON.stringify(spec)],
    );
    database.run("UPDATE dashboards SET pinned_version_id = 'v' WHERE id = 'd'");
    const queries = database
      .query<{ panel_id: string; queries: string }, []>(
        'SELECT panel_id, queries FROM library_fts WHERE panel_id IS NOT NULL ORDER BY panel_id',
      )
      .all();
    expect(queries).toEqual([
      { panel_id: 'hits', queries: 'logs logs-* {"query":{"match_all":{}}}' },
      { panel_id: 'lines', queries: 'logs {app="checkout"} |= "timeout"' },
    ]);
  });
});
