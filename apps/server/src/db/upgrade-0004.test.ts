/**
 * The fourth migration, run on a database of the release before it holding real rows: an alert's
 * history is kept, and none of it says quiet hours held a notification back.
 */
import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { temporaryDir } from '../test/fixtures.ts';
import { createAlertStateRepository } from './alert-state-repository.ts';
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
const released = [
  '0001-schema.sql',
  '0002-snapshots-questions-analyst.sql',
  '0003-version-trigger-and-layouts.sql',
];
const upgrade = '0004-quiet-hours-and-connector-visibility.sql';

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
