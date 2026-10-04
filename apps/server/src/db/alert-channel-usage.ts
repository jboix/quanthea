/** How many alerts use a notification channel: those whose active version lists it. */
import type { Database } from 'bun:sqlite';

/**
 * Creates the count of the alerts that use a channel.
 *
 * @param database - A database the migrations have run on.
 * @returns A function from a channel id to the number of alerts whose active version lists it,
 *   deactivated or not.
 */
export function createAlertChannelUsage(database: Database): (channelId: string) => number {
  const count = database.query<{ count: number }, [string]>(
    `SELECT count(*) AS count FROM alerts a
       JOIN alert_versions v ON v.alert_id = a.id AND v.version = a.active_version
     WHERE EXISTS (SELECT 1 FROM json_each(v.spec, '$.channels') WHERE value = ?)`,
  );
  return (channelId) => count.get(channelId)?.count ?? 0;
}
