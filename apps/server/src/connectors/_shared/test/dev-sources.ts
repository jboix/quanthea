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
    port: 5433,
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
  config: { url: 'http://127.0.0.1:9091' },
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
