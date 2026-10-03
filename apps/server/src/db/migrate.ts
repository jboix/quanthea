/** Applies the numbered `.sql` files in `migrations/`, each once, in name order. */
import type { Database } from 'bun:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The directory holding the migration files shipped with the server. */
const bundledMigrationsDir = join(import.meta.dir, 'migrations');

/** A migration file. */
interface Migration {
  /** The file name, such as `0001-settings-and-audit-log.sql`. Recorded once applied. */
  readonly name: string;
  /** The SQL statements in the file. */
  readonly sql: string;
}

/**
 * Lists the migration files in a directory.
 *
 * @param migrationsDir - The directory to read.
 * @returns The `.sql` files with their contents, sorted by name.
 */
function readMigrations(migrationsDir: string): Migration[] {
  return readdirSync(migrationsDir)
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(migrationsDir, name), 'utf8') }));
}

/**
 * Lists the rows that break a foreign key.
 *
 * @param database - The open database.
 * @returns One line per broken row: the table, its row id and the table it refers to.
 */
function brokenReferences(database: Database): string[] {
  return database
    .query<{ table: string; rowid: number | null; parent: string }, []>('PRAGMA foreign_key_check')
    .all()
    .map((row) => `${row.table} row ${row.rowid} refers to a missing ${row.parent} row`);
}

/**
 * Builds the function that applies one migration: its SQL and its bookkeeping row in one
 * transaction, which rolls back when a foreign key is left broken.
 *
 * @param database - The open database.
 * @returns The function. It throws when the SQL fails or leaves a broken reference.
 */
function migrationApplier(database: Database): (migration: Migration) => void {
  return database.transaction((migration: Migration) => {
    database.run(migration.sql);
    const broken = brokenReferences(database);
    if (broken.length > 0)
      throw new Error(`${migration.name} breaks foreign keys: ${broken.join('; ')}.`);
    database.run('INSERT INTO migrations (name, applied_at) VALUES (?, ?)', [
      migration.name,
      Date.now(),
    ]);
  });
}

/**
 * Lists the migrations not applied yet.
 *
 * @param database - The open database.
 * @param migrationsDir - Where the `.sql` files are.
 * @returns The pending migrations, in name order.
 */
function pendingMigrations(database: Database, migrationsDir: string): Migration[] {
  database.run(
    'CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)',
  );
  const applied = new Set(
    database
      .query<{ name: string }, []>('SELECT name FROM migrations')
      .all()
      .map((row) => row.name),
  );
  return readMigrations(migrationsDir).filter((migration) => !applied.has(migration.name));
}

/**
 * Brings the schema up to date. Each migration and its bookkeeping row commit in one transaction,
 * so a failing migration leaves the database as it was before that file.
 *
 * Migrations run with foreign keys off, so a migration can rebuild a table other tables refer to
 * (SQLite changes a CHECK only that way) without its cascades deleting their rows. Before each
 * commit, `PRAGMA foreign_key_check` must find no broken reference. The pragma cannot change
 * inside a transaction, so it is set around them, and restored afterwards.
 *
 * @param database - The open database.
 * @param migrationsDir - Where the `.sql` files are. Defaults to the ones shipped with the server.
 * @returns The names of the migrations applied by this call, in order.
 */
export function runMigrations(
  database: Database,
  migrationsDir: string = bundledMigrationsDir,
): string[] {
  const pending = pendingMigrations(database, migrationsDir);
  if (pending.length === 0) return [];
  const foreignKeys = database.query<{ foreign_keys: number }, []>('PRAGMA foreign_keys').get();
  const applyOne = migrationApplier(database);
  database.run('PRAGMA foreign_keys = OFF');
  try {
    for (const migration of pending) applyOne(migration);
  } finally {
    database.run(`PRAGMA foreign_keys = ${foreignKeys?.foreign_keys === 1 ? 'ON' : 'OFF'}`);
  }
  return pending.map((migration) => migration.name);
}
