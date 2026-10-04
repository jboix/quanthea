/** Reads the JSON columns of a stored thread: its queries and the panel it starts from. */
import {
  type AlertSeed,
  alertSeedSchema,
  type ThreadQueries,
  threadQueriesSchema,
} from '@quanthea/shared';

/**
 * Reads a stored seed.
 *
 * @param stored - The JSON, or `NULL`.
 * @returns The seed, or `null` when there is none or it no longer parses.
 */
export function seedOf(stored: string | null): AlertSeed | null {
  if (stored === null) return null;
  return alertSeedSchema.safeParse(JSON.parse(stored)).data ?? null;
}

/**
 * The queries of a stored thread.
 *
 * @param stored - The stored JSON, or `null`.
 * @returns The queries; the default set when none or invalid.
 */
export function queriesOf(stored: string | null): ThreadQueries {
  if (stored === null) return { mode: 'default' };
  return threadQueriesSchema.safeParse(JSON.parse(stored)).data ?? { mode: 'default' };
}
