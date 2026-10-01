/** Opens the SQLite database in the data directory. */
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** The database file name inside the data directory. */
const databaseFileName = 'quanthea.db';

/**
 * Opens (and creates, the first time) the database with the pragmas the app relies on:
 * write-ahead logging, enforced foreign keys and a 5 s busy timeout.
 *
 * @param dataDir - The data directory. It is created with mode 0700 when missing.
 * @returns The open database. The caller closes it on shutdown.
 */
export function openDatabase(dataDir: string): Database {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const database = new Database(join(dataDir, databaseFileName), { create: true, strict: true });
  database.run('PRAGMA journal_mode = WAL');
  database.run('PRAGMA foreign_keys = ON');
  database.run('PRAGMA busy_timeout = 5000');
  return database;
}
