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
 * Brings the schema up to date. Each migration and its bookkeeping row commit in one transaction,
 * so a failing migration leaves the database as it was before that file.
 *
 * @param database - The open database.
 * @param migrationsDir - Where the `.sql` files are. Defaults to the ones shipped with the server.
 * @returns The names of the migrations applied by this call, in order.
 */
export function runMigrations(
  database: Database,
  migrationsDir: string = bundledMigrationsDir,
): string[] {
  database.run(
    'CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)',
  );
  const applied = new Set(
    database
      .query<{ name: string }, []>('SELECT name FROM migrations')
      .all()
      .map((row) => row.name),
  );
  const pending = readMigrations(migrationsDir).filter((migration) => !applied.has(migration.name));
  const applyOne = database.transaction((migration: Migration) => {
    database.run(migration.sql);
    database.run('INSERT INTO migrations (name, applied_at) VALUES (?, ?)', [
      migration.name,
      Date.now(),
    ]);
  });
  return pending.map((migration) => {
    applyOne(migration);
    return migration.name;
  });
}
