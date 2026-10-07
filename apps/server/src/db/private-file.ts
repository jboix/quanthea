/** Keeps the database files readable by their owner only. */
import { chmodSync, closeSync, existsSync, openSync, statSync } from 'node:fs';
import type { Logger } from '../lib/logger.ts';

/** Read and write for the owner only. */
const ownerOnly = 0o600;

/** The errors that mean the mode cannot be changed, which the server survives with a warning. */
const unchangeableCodes = new Set(['EPERM', 'EACCES', 'EROFS']);

/**
 * Narrows a file to its owner, creating it with that mode when asked. A file whose mode cannot
 * be changed, such as one another user owns, is left as it is with a warning.
 *
 * @param path - The file.
 * @param create - Whether to create the file when it is missing.
 * @param logger - Receives the warning when the mode cannot be changed.
 * @throws {Error} When the file cannot be created, or its mode cannot be changed for another reason.
 */
export function makePrivate(path: string, create: boolean, logger?: Logger): void {
  if (!existsSync(path)) {
    if (create) closeSync(openSync(path, 'a', ownerOnly));
    return;
  }
  if ((statSync(path).mode & 0o077) === 0) return;
  try {
    chmodSync(path, ownerOnly);
  } catch (error) {
    if (!unchangeableCodes.has((error as NodeJS.ErrnoException).code ?? '')) throw error;
    logger?.warn('Others than its owner may read a database file. Use mode 0600.', { path });
  }
}
