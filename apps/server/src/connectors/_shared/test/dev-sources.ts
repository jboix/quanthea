/**
 * The local data sources of `bun run env:up`, for integration tests. The tests that need them run
 * only with QUERENT_INTEGRATION=1 (`bun run test:integration`).
 */

/** Whether the integration tests run. */
export const integrationEnabled = process.env.QUERENT_INTEGRATION === '1';

/** The dev Postgres as the read-only role, in the Postgres connector's configuration shape. */
export const devPostgres = {
  config: {
    host: '127.0.0.1',
    // Another port, for a second copy of the data sources beside the usual one.
    port: Number(process.env.QUERENT_DEV_POSTGRES_PORT ?? 5433),
    database: 'orders',
    username: 'dash_ro',
    tls: 'disable',
  },
  secret: { password: 'dash-ro-dev' },
};

/** The dev Postgres as the owner, which can write. */
export const devPostgresOwner = {
  config: { ...devPostgres.config, username: 'querent_admin' },
  secret: { password: 'querent-dev' },
};

/** The dev Prometheus, in the Prometheus connector's configuration shape. */
export const devPrometheus = {
  config: { url: `http://127.0.0.1:${process.env.QUERENT_DEV_PROMETHEUS_PORT ?? 9091}` },
  secret: {},
};

/**
 * When the seeded incident starts: yesterday at 12:02 UTC, as in `dev/metrics/incident.ts`.
 *
 * @param now - The current time.
 * @returns The start of the incident.
 */
export function devIncidentStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 12, 2));
}

/** How long the first scrape of the dev Prometheus may take: its interval is 15 seconds. */
const firstScrapeTimeoutMs = 30_000;

/**
 * Waits until the dev Prometheus has scraped the live metrics once, so what only a scrape brings
 * exists: `up`, and each metric's type. Right after `bun run env:up` it holds only the backfilled
 * history.
 *
 * @returns Once a scrape is in.
 * @throws {Error} When no scrape comes in time.
 */
export async function waitForFirstScrape(): Promise<void> {
  const query = `${devPrometheus.config.url}/api/v1/query?query=up`;
  const deadline = Date.now() + firstScrapeTimeoutMs;
  while (Date.now() < deadline) {
    const answer = (await (await fetch(query)).json()) as { data?: { result?: unknown[] } };
    if ((answer.data?.result?.length ?? 0) > 0) return;
    await Bun.sleep(500);
  }
  throw new Error('The dev Prometheus has not scraped the live metrics yet.');
}
