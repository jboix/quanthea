/**
 * Whether the dev data tells of yesterday's incident. Every source is seeded once per data volume,
 * around the yesterday of that day, so data seeded on an earlier day has its incident on an earlier
 * day too. `bun run env:up` seeds such data again (dev/refresh.ts).
 */
import { SQL } from 'bun';
import { incidentStart } from './metrics/incident.ts';

/** The dev Postgres as the read-only role. */
const postgresUrl = `postgres://dash_ro:dash-ro-dev@127.0.0.1:${process.env.QUANTHEA_DEV_POSTGRES_PORT ?? 5433}/orders`;

/**
 * When the dev Postgres says the incident started: the time of deploy #481.
 *
 * @returns The instant, or `undefined` when the database has no such deploy.
 */
async function seededIncident(): Promise<Date | undefined> {
  const sql = new SQL(postgresUrl);
  try {
    const rows = await sql`SELECT deployed_at FROM deploys WHERE id = 481`;
    const value = (rows[0] as { deployed_at?: Date } | undefined)?.deployed_at;
    return value === undefined ? undefined : new Date(value);
  } finally {
    await sql.close();
  }
}

/**
 * A day as people read it, such as `Wed 30 Sep`.
 *
 * @param date - The day.
 * @returns The words.
 */
function dayOf(date: Date): string {
  const format = { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' } as const;
  return date.toLocaleDateString('en-GB', format);
}

/**
 * Why the dev data does not tell of yesterday's incident, if it does not.
 *
 * @param now - The current instant; the incident is the day before it.
 * @returns The reason, with what to run, or `undefined` when the data is current.
 */
export async function staleDataReason(now: Date): Promise<string | undefined> {
  const expected = incidentStart(now);
  const seeded = await seededIncident();
  if (seeded === undefined)
    return 'The dev Postgres has no deploy #481. Run bun run env:down && bun run env:up.';
  if (seeded.getTime() === expected.getTime()) return undefined;
  return `The dev data tells of an incident on ${dayOf(seeded)}, not yesterday (${dayOf(expected)}). Run bun run env:up: it seeds the data again around yesterday.`;
}
