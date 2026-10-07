import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { captureLogs, temporaryDir } from '../test/fixtures.ts';
import { openDatabase } from './database.ts';
import { makePrivate } from './private-file.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let previousUmask: number;

beforeEach(() => {
  dataDir = temporaryDir();
  // A permissive umask, as on a host that never set one.
  previousUmask = process.umask(0o022);
});

afterEach(() => {
  process.umask(previousUmask);
  dataDir.remove();
});

/**
 * The permission bits of a file in the data directory.
 *
 * @param name - The file name.
 * @returns The mode's permission bits.
 */
function modeOf(name: string): number {
  return statSync(join(dataDir.path, name)).mode & 0o777;
}

describe('opening the database', () => {
  test('keeps the database files readable by their owner only', () => {
    const database = openDatabase(dataDir.path);
    database.run('CREATE TABLE sample (id INTEGER)');
    database.run('INSERT INTO sample VALUES (1)');
    for (const name of ['quanthea.db', 'quanthea.db-wal', 'quanthea.db-shm']) {
      expect(existsSync(join(dataDir.path, name))).toBe(true);
      expect(modeOf(name)).toBe(0o600);
    }
    database.close();
  });

  test('narrows the files of an existing database to their owner', () => {
    writeFileSync(join(dataDir.path, 'quanthea.db'), '', { mode: 0o644 });
    chmodSync(join(dataDir.path, 'quanthea.db'), 0o644);
    openDatabase(dataDir.path).close();
    expect(modeOf('quanthea.db')).toBe(0o600);
  });

  test('warns when others than its owner may enter the data directory', () => {
    chmodSync(dataDir.path, 0o755);
    const { logger, lines } = captureLogs();
    openDatabase(dataDir.path, logger).close();
    expect(lines).toContainEqual(expect.objectContaining({ level: 'warn', path: dataDir.path }));
  });

  test('says nothing about a data directory only its owner may enter', () => {
    chmodSync(dataDir.path, 0o700);
    const { logger, lines } = captureLogs();
    openDatabase(dataDir.path, logger).close();
    expect(lines).toEqual([]);
  });

  // A file owned by root stands in for one an earlier runtime user created; root may chmod it.
  test.skipIf(process.getuid?.() === 0)(
    'warns instead of stopping when a database file cannot be narrowed',
    () => {
      const path = join(dataDir.path, 'quanthea.db');
      symlinkSync('/etc/passwd', path);
      const { logger, lines } = captureLogs();
      expect(() => makePrivate(path, false, logger)).not.toThrow();
      expect(lines).toContainEqual(expect.objectContaining({ level: 'warn', path }));
    },
  );
});
