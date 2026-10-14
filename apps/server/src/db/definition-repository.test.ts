import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { temporaryDir } from '../test/fixtures.ts';
import { openDatabase } from './database.ts';
import { createDefinitionRepository, type NewDefinition } from './definition-repository.ts';
import { runMigrations } from './migrate.ts';

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

/**
 * A version of the error rate.
 *
 * @param meaning - Its meaning.
 * @param deleted - Whether it deletes the definition.
 * @returns The version to add.
 */
function errorRate(meaning: string, deleted = false): NewDefinition {
  const definition = { id: 'error-rate', name: 'Error rate', meaning, bodies: [] };
  return {
    definitionId: 'error-rate',
    definition,
    deleted,
    origin: 'ui',
    actor: 'editor-1',
    createdAt: 1000,
  };
}

describe('definition repository', () => {
  test('adds versions after the latest, and refuses one based on an older version', () => {
    const repository = createDefinitionRepository(database);
    expect(repository.add(errorRate('ERROR over START.'), null)?.version).toBe(1);
    expect(repository.add(errorRate('ERROR, no business errors, over START.'), 1)?.version).toBe(2);
    expect(repository.add(errorRate('Something else.'), 1)).toBeUndefined();
    expect(repository.history('error-rate').map((row) => row.version)).toEqual([2, 1]);
  });

  test('lists the latest version of each definition, without the deleted ones', () => {
    const repository = createDefinitionRepository(database);
    repository.add(errorRate('ERROR over START.'), null);
    const sessions = { ...errorRate('One playback.'), definitionId: 'sessions' };
    repository.add(sessions, null);
    repository.add(errorRate('ERROR over START.', true), 1);
    expect(repository.current().map((row) => row.definitionId)).toEqual(['sessions']);
    expect(repository.latest('error-rate')?.deleted).toBe(true);
  });

  test('never rewrites or removes a version', () => {
    createDefinitionRepository(database).add(errorRate('ERROR over START.'), null);
    expect(() => database.run("UPDATE definition_versions SET actor = 'x'")).toThrow('immutable');
    expect(() => database.run('DELETE FROM definition_versions')).toThrow('kept');
  });
});
