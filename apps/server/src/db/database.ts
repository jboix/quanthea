/** Opens the SQLite database in the data directory. */
import { Database } from 'bun:sqlite';
import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from '../lib/logger.ts';
import { makePrivate } from './private-file.ts';

/** The database file name inside the data directory. */
const databaseFileName = 'quanthea.db';

/** The files SQLite keeps beside the database in write-ahead logging. */
const companionSuffixes = ['-wal', '-shm'] as const;

/**
 * Opens (and creates, the first time) the database with the pragmas the app relies on:
 * write-ahead logging, enforced foreign keys and a 5 s busy timeout. The database files are
 * readable by their owner only, whatever the umask. A file whose mode cannot be changed is
 * warned about instead.
 *
 * @param dataDir - The data directory. It is created with mode 0700 when missing.
 * @param logger - Receives a warning when others than the owner may enter the data directory or
 *   read a database file.
 * @returns The open database. The caller closes it on shutdown.
 */
export function openDatabase(dataDir: string, logger?: Logger): Database {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  if (logger !== undefined) warnAboutOpenDirectory(dataDir, logger);
  const path = join(dataDir, databaseFileName);
  // SQLite gives the files it creates beside the database the database's mode, so create it first.
  makePrivate(path, true, logger);
  const database = new Database(path, { create: true, strict: true });
  database.run('PRAGMA journal_mode = WAL');
  database.run('PRAGMA foreign_keys = ON');
  database.run('PRAGMA busy_timeout = 5000');
  for (const suffix of companionSuffixes) makePrivate(`${path}${suffix}`, false, logger);
  return database;
}

/**
 * Warns when the data directory has group or other permission bits.
 *
 * @param dataDir - The data directory.
 * @param logger - Receives the warning.
 */
function warnAboutOpenDirectory(dataDir: string, logger: Logger): void {
  if ((statSync(dataDir).mode & 0o077) === 0) return;
  logger.warn('Others than its owner may enter the data directory. Use mode 0700.', {
    path: dataDir,
  });
}
