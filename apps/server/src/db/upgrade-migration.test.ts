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
const released = '0001-schema.sql';
const upgrade = '0002-snapshots-questions-analyst.sql';

/**
 * Builds a database at the schema of the last release.
 *
 * @returns The directory the released files were copied to, to add the upgrade.
 */
function releasedDatabase(): string {
  const migrationsDir = join(dataDir.path, 'migrations');
  mkdirSync(migrationsDir, { recursive: true });
  copyFileSync(join(shipped, released), join(migrationsDir, released));
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

/**
 * Stores a usage event.
 *
 * @param id - The id.
 * @param kind - The kind: a model step or a view.
 */
function storeEvent(id: string, kind: string): void {
  database.run(
    "INSERT INTO usage_events (id, at, kind, dashboard_id, job) VALUES (?, 1, ?, 'd', 'build')",
    [id, kind],
  );
}

/**
 * The kind and feature of each usage event.
 *
 * @returns Them, by id.
 */
function ledger(): Record<string, { kind: string; feature: string | null }> {
  const rows = database
    .query<{ id: string; kind: string; feature: string | null }, []>(
      'SELECT id, kind, feature FROM usage_events',
    )
    .all();
  return Object.fromEntries(rows.map(({ id, kind, feature }) => [id, { kind, feature }]));
}

describe('the users after the upgrade', () => {
  test('keep every row that refers to them, and the analyst role is stored', () => {
    const migrationsDir = releasedDatabase();
    storeUserWithEverything('ada', 'editor');
    expect(() => storeUserWithEverything('refused', 'analyst')).toThrow('CHECK');
    upgradeDatabase(migrationsDir);
    const everything = { sessions: 1, password_links: 1, identities: 1 };
    expect(rowsOf('ada')).toEqual(everything);
    storeUserWithEverything('grace', 'analyst');
    expect(rowsOf('grace')).toEqual(everything);
    expect(() => storeUserWithEverything('nobody', 'owner')).toThrow('CHECK');
  });

  test('keep their references enforced, with their cascades', () => {
    const migrationsDir = releasedDatabase();
    storeUserWithEverything('ada', 'admin');
    upgradeDatabase(migrationsDir);
    expect(() =>
      database.run("INSERT INTO sessions VALUES ('s', 'p', 'missing', 1, 1, 2)"),
    ).toThrow('FOREIGN KEY');
    database.run("DELETE FROM users WHERE id = 'ada'");
    expect(rowsOf('ada')).toEqual({ sessions: 0, password_links: 0, identities: 0 });
  });
});

describe('the usage ledger after the upgrade', () => {
  test('counts every past model step as building, and views as no feature', () => {
    const migrationsDir = releasedDatabase();
    storeEvent('step', 'model');
    storeEvent('view', 'pinned_view');
    expect(() => storeEvent('refused', 'snapshot_view')).toThrow('CHECK');
    upgradeDatabase(migrationsDir);
    storeEvent('snapshot', 'snapshot_view');
    expect(ledger()).toEqual({
      step: { kind: 'model', feature: 'building' },
      view: { kind: 'pinned_view', feature: null },
      snapshot: { kind: 'snapshot_view', feature: null },
    });
  });

  test('refuses a feature it does not know', () => {
    upgradeDatabase(releasedDatabase());
    expect(() =>
      database.run(
        "INSERT INTO usage_events (id, at, kind, feature) VALUES ('x', 1, 'model', 'chatting')",
      ),
    ).toThrow('CHECK');
  });
});

/** Stores the dashboard `d`, then a snapshot, a question and an explanation of it. */
function storeDashboardRecords(): void {
  database.run(
    "INSERT INTO dashboards (id, title, created_at, updated_at) VALUES ('d', 'D', 0, 0)",
  );
  database.run(
    `INSERT INTO snapshots (id, dashboard_id, version, title, time_from, time_to, variables,
       hidden_markers, spec, panels, bytes, taken_by, taken_at)
     VALUES ('s', 'd', 1, 'D', 0, 1, '{}', '[]', '{}', '{}', 2, 'ada', 1)`,
  );
  database.run(
    `INSERT INTO dashboard_questions (id, dashboard_id, version, time_from, time_to, time_zone,
       variables, hidden_markers, explain_only, asked_by, asked_at, question, answer, citations,
       evidence, usage, tokens, root_id, time_chosen)
     VALUES ('q', 'd', 1, 0, 1, 'UTC', '{}', '[]', 0, 'ada', 1, 'Why errors?', 'A deploy.', '[]',
       '[]', '{}', 10, 'q', '{"from":"now-1h","to":"now"}')`,
  );
  database.run(
    `INSERT INTO panel_explanations (id, dashboard_id, version, panel_id, explained_by,
       explained_at, text, usage, tokens)
     VALUES ('e', 'd', 1, 'p', 'ada', 1, 'It counts.', '{}', 10)`,
  );
}

/**
 * Counts the rows of a table.
 *
 * @param table - The table.
 * @returns The count.
 */
function countOf(table: string): number {
  return database.query<{ count: number }, []>(`SELECT count(*) AS count FROM ${table}`).get()
    ?.count as number;
}

describe('the new tables after the upgrade', () => {
  test('hold snapshots, questions and explanations, and lose them with their dashboard', () => {
    upgradeDatabase(releasedDatabase());
    storeDashboardRecords();
    const found = database
      .query<{ id: string }, []>(
        "SELECT question_id AS id FROM question_fts WHERE question_fts MATCH 'error'",
      )
      .all();
    expect(found).toEqual([{ id: 'q' }]);
    expect(() => database.run("UPDATE panel_explanations SET text = 'x'")).toThrow(
      'never rewritten',
    );
    database.run("DELETE FROM dashboards WHERE id = 'd'");
    const tables = ['snapshots', 'dashboard_questions', 'question_fts', 'panel_explanations'];
    expect(tables.map(countOf)).toEqual([0, 0, 0, 0]);
  });

  test('hold notification channels and their log, which goes with its channel', () => {
    upgradeDatabase(releasedDatabase());
    database.run(
      `INSERT INTO notification_channels (id, name, kind, target_hint, secret, created_by,
         created_at, updated_at) VALUES ('c', 'Ops', 'webhook', 'ops.test', x'00', 'ada', 1, 1)`,
    );
    const send = (id: string, event: string) =>
      database.run(
        `INSERT INTO notification_sends (id, channel_id, event, alert_id, series_key, at, ok,
           attempts) VALUES (?, 'c', ?, 'a', '', 1, 1, 1)`,
        [id, event],
      );
    send('s', 'alert.firing');
    expect(() => send('t', 'alert.unknown')).toThrow('CHECK');
    expect(() =>
      database.run(
        "INSERT INTO notification_channels (id, name, kind, target_hint, secret, created_by, created_at, updated_at) VALUES ('d', 'Ops', 'slack', 'x', x'00', 'ada', 1, 1)",
      ),
    ).toThrow('UNIQUE');
    database.run("DELETE FROM notification_channels WHERE id = 'c'");
    expect(countOf('notification_sends')).toBe(0);
  });
});

/** Stores a thread, and the alert `a` it made with an active version, a series and an event. */
function storeAlertRecords(): void {
  database.run("INSERT INTO threads (id, created_at, updated_at) VALUES ('t', 0, 0)");
  database.run(
    `INSERT INTO alerts (id, title, thread_id, created_by, created_at, updated_at)
     VALUES ('a', 'Checkout 5xx', 't', 'ada', 0, 0)`,
  );
  database.run(
    `INSERT INTO alert_versions (alert_id, version, spec, created_by, created_at)
     VALUES ('a', 1, '{}', 'ada', 0)`,
  );
  database.run("UPDATE alerts SET active_version = 1 WHERE id = 'a'");
  database.run(
    `INSERT INTO alert_series (alert_id, series_key, labels, state, since, last_seen_at,
       evaluated_at) VALUES ('a', '{}', '{}', 'firing', 0, 0, 0)`,
  );
  database.run(
    `INSERT INTO alert_events (id, alert_id, version, series_key, labels, from_state, to_state, at)
     VALUES ('e', 'a', 1, '{}', '{}', 'pending', 'firing', 0)`,
  );
}

describe('the alerts after the upgrade', () => {
  test('hold versions that are never rewritten, and an active version that exists', () => {
    upgradeDatabase(releasedDatabase());
    storeAlertRecords();
    expect(() => database.run("UPDATE alert_versions SET spec = '[]'")).toThrow('immutable');
    database.run("UPDATE alert_versions SET activated_at = 1 WHERE alert_id = 'a'");
    expect(() => database.run('UPDATE alert_versions SET activated_at = 2')).toThrow('first');
    expect(() => database.run("UPDATE alerts SET active_version = 9 WHERE id = 'a'")).toThrow(
      'FOREIGN KEY',
    );
    expect(() => database.run("UPDATE alert_series SET state = 'loud'")).toThrow('CHECK');
  });

  test('outlive the thread that made them, and take their state with them when deleted', () => {
    upgradeDatabase(releasedDatabase());
    storeAlertRecords();
    database.run("DELETE FROM threads WHERE id = 't'");
    const thread = database.query<{ thread_id: string | null }, []>('SELECT thread_id FROM alerts');
    expect(thread.get()).toEqual({ thread_id: null });
    database.run("DELETE FROM alerts WHERE id = 'a'");
    const tables = ['alerts', 'alert_versions', 'alert_series', 'alert_events'];
    expect(tables.map(countOf)).toEqual([0, 0, 0, 0]);
  });
});
