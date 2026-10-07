/** Opens the SQLite database in the data directory. */
import { Database } from 'bun:sqlite';
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from '../lib/logger.ts';

/** The database file name inside the data directory. */
const databaseFileName = 'quanthea.db';

/** The files SQLite keeps beside the database in write-ahead logging. */
const companionSuffixes = ['-wal', '-shm'] as const;

/** Read and write for the owner only. */
const ownerOnly = 0o600;

/**
 * Opens (and creates, the first time) the database with the pragmas the app relies on:
 * write-ahead logging, enforced foreign keys and a 5 s busy timeout. The database files are
 * readable by their owner only, whatever the umask.
 *
 * @param dataDir - The data directory. It is created with mode 0700 when missing.
 * @param logger - Receives a warning when others than the owner may enter the data directory.
 * @returns The open database. The caller closes it on shutdown.
 */
export function openDatabase(dataDir: string, logger?: Logger): Database {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  if (logger !== undefined) warnAboutOpenDirectory(dataDir, logger);
  const path = join(dataDir, databaseFileName);
  makePrivate(path, true);
  const database = new Database(path, { create: true, strict: true });
  database.run('PRAGMA journal_mode = WAL');
  database.run('PRAGMA foreign_keys = ON');
  database.run('PRAGMA busy_timeout = 5000');
  for (const suffix of companionSuffixes) makePrivate(`${path}${suffix}`, false);
  return database;
}

/**
 * Narrows a file to its owner. SQLite gives the files it creates beside the database the
 * database's mode, so the database file is created here first.
 *
 * @param path - The file.
 * @param create - Whether to create the file when it is missing.
 */
function makePrivate(path: string, create: boolean): void {
  if (!existsSync(path)) {
    if (!create) return;
    closeSync(openSync(path, 'a', ownerOnly));
  }
  chmodSync(path, ownerOnly);
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
