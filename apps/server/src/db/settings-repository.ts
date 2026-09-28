/** Reads and writes rows of the `settings` table. Values are opaque JSON text here. */
import type { Database } from 'bun:sqlite';

/** Stores settings values by key. */
export interface SettingsRepository {
  /**
   * Reads the raw value stored under a key.
   *
   * @param key - The settings key, such as `auth`.
   * @returns The stored JSON text, or `undefined` when the key was never written.
   */
  read(key: string): string | undefined;
  /**
   * Stores a raw value under a key, replacing any previous value.
   *
   * @param key - The settings key.
   * @param value - The JSON text to store.
   */
  write(key: string, value: string): void;
}

/**
 * Creates the repository over an open database.
 *
 * @param database - A database the migrations have run on.
 * @returns The repository.
 */
export function createSettingsRepository(database: Database): SettingsRepository {
  const selectValue = database.query<{ value: string }, [string]>(
    'SELECT value FROM settings WHERE key = ?',
  );
  const upsertValue = database.query<unknown, [string, string, number]>(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );
  return {
    read: (key) => selectValue.get(key)?.value,
    write: (key, value) => {
      upsertValue.run(key, value, Date.now());
    },
  };
}
