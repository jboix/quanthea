import { describe, expect, test } from 'bun:test';
import type { SettingsRepository } from '../db/settings-repository.ts';
import { createSettingsStore } from './settings-store.ts';

/**
 * Creates a repository backed by a map.
 *
 * @param initial - Rows present from the start.
 * @returns The repository and its rows.
 */
function memoryRepository(initial: Record<string, string> = {}) {
  const rows = new Map(Object.entries(initial));
  const repository: SettingsRepository = {
    read: (key) => rows.get(key),
    write: (key, value) => {
      rows.set(key, value);
    },
  };
  return { repository, rows };
}

describe('settings store', () => {
  test('returns the default for a section never saved', () => {
    const store = createSettingsStore(memoryRepository().repository);
    expect(store.read('retention')).toEqual({ binDays: 30 });
  });

  test('saves a section as JSON and reads it back', () => {
    const { repository, rows } = memoryRepository();
    const store = createSettingsStore(repository);
    store.write('retention', { binDays: 7 });
    expect(rows.get('retention')).toBe('{"binDays":7}');
    expect(store.read('retention')).toEqual({ binDays: 7 });
  });

  test('refuses a stored value that no longer matches the schema', () => {
    const stored = memoryRepository({ retention: '{"binDays":"forever"}' }).repository;
    const store = createSettingsStore(stored);
    expect(() => store.read('retention')).toThrow(
      'Stored settings section "retention" is invalid.',
    );
  });
});
