import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { copyFileSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
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
      '0002-snapshots.sql',
      '0003-analyst-role.sql',
      '0004-dashboard-questions.sql',
      '0005-panel-explanations.sql',
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

describe('the snapshots migration', () => {
  test('keeps the usage ledger while it lets the ledger count snapshot views', () => {
    const shipped = join(import.meta.dir, 'migrations');
    const migrationsDir = join(dataDir.path, 'migrations');
    mkdirSync(migrationsDir);
    copyFileSync(join(shipped, '0001-schema.sql'), join(migrationsDir, '0001-schema.sql'));
    runMigrations(database, migrationsDir);
    const view = (id: string, kind: string) =>
      database.run("INSERT INTO usage_events (id, at, kind, dashboard_id) VALUES (?, 1, ?, 'd')", [
        id,
        kind,
      ]);
    view('before', 'pinned_view');
    expect(() => view('refused', 'snapshot_view')).toThrow('CHECK');
    copyFileSync(join(shipped, '0002-snapshots.sql'), join(migrationsDir, '0002-snapshots.sql'));
    expect(runMigrations(database, migrationsDir)).toEqual(['0002-snapshots.sql']);
    view('after', 'snapshot_view');
    const rows = database
      .query<{ id: string; kind: string }, []>('SELECT id, kind FROM usage_events ORDER BY id')
      .all();
    expect(rows).toEqual([
      { id: 'after', kind: 'snapshot_view' },
      { id: 'before', kind: 'pinned_view' },
    ]);
  });
});

/**
 * Applies the shipped migrations up to and including one file.
 *
 * @param last - The name of the last file to apply.
 * @returns The directory the files were copied to, to add later ones.
 */
function migrateUpTo(last: string): string {
  const shipped = join(import.meta.dir, 'migrations');
  const migrationsDir = join(dataDir.path, 'migrations');
  mkdirSync(migrationsDir, { recursive: true });
  for (const name of readdirSync(shipped).filter((each) => each <= last))
    copyFileSync(join(shipped, name), join(migrationsDir, name));
  runMigrations(database, migrationsDir);
  return migrationsDir;
}

/**
 * Stores a user with a session, a password link and a provider identity.
 *
 * @param id - The user's id.
 * @param role - Their role.
 */
function storeUserWithEverything(id: string, role: string): void {
  database.run(
    `INSERT INTO users (id, email_index, email_sealed, name_sealed, role, created_at, updated_at)
     VALUES (?, ?, x'00', x'00', ?, 1, 1)`,
    [id, `index-${id}`, role],
  );
  database.run('INSERT INTO sessions VALUES (?, ?, ?, 1, 1, 2)', [
    `session-${id}`,
    `public-${id}`,
    id,
  ]);
  database.run("INSERT INTO password_links VALUES (?, ?, 'invite', 2, 'admin', 1)", [
    `link-${id}`,
    id,
  ]);
  database.run("INSERT INTO identities VALUES ('github', ?, x'00', ?, 1, NULL)", [
    `subject-${id}`,
    id,
  ]);
}

/**
 * Counts the rows that refer to a user, by table.
 *
 * @param id - The user's id.
 * @returns The counts.
 */
function rowsOf(id: string): Record<string, number> {
  const count = (table: string) =>
    database
      .query<{ count: number }, [string]>(
        `SELECT count(*) AS count FROM ${table} WHERE user_id = ?`,
      )
      .get(id)?.count ?? 0;
  return {
    sessions: count('sessions'),
    password_links: count('password_links'),
    identities: count('identities'),
  };
}

describe('the analyst role migration', () => {
  test('keeps every user and every row that refers to one, and stores analysts', () => {
    const migrationsDir = migrateUpTo('0002-snapshots.sql');
    storeUserWithEverything('ada', 'editor');
    expect(() => storeUserWithEverything('refused', 'analyst')).toThrow('CHECK');
    const shipped = join(import.meta.dir, 'migrations', '0003-analyst-role.sql');
    copyFileSync(shipped, join(migrationsDir, '0003-analyst-role.sql'));
    expect(runMigrations(database, migrationsDir)).toEqual(['0003-analyst-role.sql']);
    const everything = { sessions: 1, password_links: 1, identities: 1 };
    expect(rowsOf('ada')).toEqual(everything);
    storeUserWithEverything('grace', 'analyst');
    expect(rowsOf('grace')).toEqual(everything);
    expect(() => storeUserWithEverything('nobody', 'owner')).toThrow('CHECK');
  });

  test('keeps the references to users enforced, with their cascades', () => {
    migrateUpTo('0003-analyst-role.sql');
    storeUserWithEverything('ada', 'analyst');
    expect(() =>
      database.run("INSERT INTO sessions VALUES ('s', 'p', 'missing', 1, 1, 2)"),
    ).toThrow('FOREIGN KEY');
    database.run("DELETE FROM users WHERE id = 'ada'");
    expect(rowsOf('ada')).toEqual({ sessions: 0, password_links: 0, identities: 0 });
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
