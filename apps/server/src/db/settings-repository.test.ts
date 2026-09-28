import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { temporaryDir } from '../test/fixtures.ts';
import { openDatabase } from './database.ts';
import { runMigrations } from './migrate.ts';
import { createSettingsRepository } from './settings-repository.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let database: Database;

beforeEach(() => {
  dataDir = temporaryDir();
  database = openDatabase(dataDir.path);
  runMigrations(database);
});

afterEach(() => {
  database.close();
  dataDir.remove();
});

test('reads nothing for an unknown key, then the latest value written', () => {
  const repository = createSettingsRepository(database);
  expect(repository.read('auth')).toBeUndefined();
  repository.write('auth', '{"mode":"none"}');
  repository.write('auth', '{"mode":"basic"}');
  expect(repository.read('auth')).toBe('{"mode":"basic"}');
});
