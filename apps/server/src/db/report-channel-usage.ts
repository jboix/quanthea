/** How many reports use a notification channel: those whose active version sends to it. */
import type { Database } from 'bun:sqlite';

/**
 * Creates the count of the reports that use a channel.
 *
 * @param database - A database the migrations have run on.
 * @returns A function from a channel id to the number of reports whose active version lists it,
 *   deactivated or not.
 */
export function createReportChannelUsage(database: Database): (channelId: string) => number {
  const count = database.query<{ count: number }, [string]>(
    `SELECT count(*) AS count FROM reports r
       JOIN report_versions v ON v.report_id = r.id AND v.version = r.active_version
     WHERE EXISTS (SELECT 1 FROM json_each(v.spec, '$.delivery.channels') WHERE value = ?)`,
  );
  return (channelId) => count.get(channelId)?.count ?? 0;
}
