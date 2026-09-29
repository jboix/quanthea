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
    expect(store.read('auth')).toEqual({ mode: 'none' });
  });

  test('saves a section as JSON and reads it back', () => {
    const { repository, rows } = memoryRepository();
    const store = createSettingsStore(repository);
    store.write('auth', { mode: 'accounts' });
    expect(rows.get('auth')).toBe('{"mode":"accounts"}');
    expect(store.read('auth')).toEqual({ mode: 'accounts' });
  });

  test('reads a mode saved as basic or oidc as accounts', () => {
    for (const mode of ['basic', 'oidc']) {
      const store = createSettingsStore(
        memoryRepository({ auth: JSON.stringify({ mode }) }).repository,
      );
      expect(store.read('auth')).toEqual({ mode: 'accounts' });
    }
  });

  test('refuses a stored value that no longer matches the schema', () => {
    const store = createSettingsStore(memoryRepository({ auth: '{"mode":"keycloak"}' }).repository);
    expect(() => store.read('auth')).toThrow('Stored settings section "auth" is invalid.');
  });
});
