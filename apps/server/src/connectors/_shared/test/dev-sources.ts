/**
 * The local data sources of `bun run env:up`, for integration tests. The tests that need them run
 * only when QUANTHEA_INTEGRATION names their set, comma-separated: `core` (or `1`) for Postgres and
 * Prometheus (`bun run test:integration`), `timescale` for TimescaleDB
 * (`bun run test:integration:timescale`), `mysql` for MySQL and MariaDB
 * (`bun run test:integration:mysql`), `clickhouse` for ClickHouse
 * (`bun run test:integration:clickhouse`), `trino` for Trino over the dev Postgres
 * (`bun run test:integration:trino`), `search` for Elasticsearch and OpenSearch
 * (`bun run test:integration:search`), `loki` for Loki (`bun run test:integration:loki`), `http`
 * for the dev HTTP API (`bun run test:integration:http`), `influxdb` for InfluxDB 3
 * (`bun run test:integration:influxdb`), `valkey` for Valkey (`bun run test:integration:valkey`),
 * `mongodb` for MongoDB (`bun run test:integration:mongodb`).
 */

/** A set of data sources that start together. */
type SourceSet =
  | 'core'
  | 'timescale'
  | 'mysql'
  | 'clickhouse'
  | 'trino'
  | 'search'
  | 'loki'
  | 'http'
  | 'influxdb'
  | 'valkey'
  | 'mongodb';

/** The sets the integration tests run against. */
const integrationSets = new Set(
  (process.env.QUANTHEA_INTEGRATION ?? '')
    .split(',')
    .map((name) => name.trim())
    .map((name) => (name === '1' ? 'core' : name)),
);

/**
 * Whether the integration tests of a set of data sources run.
 *
 * @param set - The set.
 * @returns Whether QUANTHEA_INTEGRATION names it.
 */
export function integrationFor(set: SourceSet): boolean {
  return integrationSets.has(set);
}

/** Whether the integration tests against Postgres and Prometheus run. */
export const integrationEnabled = integrationFor('core');

/** The dev Postgres as the read-only role, in the Postgres connector's configuration shape. */
export const devPostgres = {
  config: {
    host: '127.0.0.1',
    // Another port, for a second copy of the data sources beside the usual one.
    port: Number(process.env.QUANTHEA_DEV_POSTGRES_PORT ?? 5433),
    database: 'orders',
    username: 'dash_ro',
    tls: 'disable',
  },
  secret: { password: 'dash-ro-dev' },
};

/** The dev Postgres as the owner, which can write. */
export const devPostgresOwner = {
  config: { ...devPostgres.config, username: 'quanthea_admin' },
  secret: { password: 'quanthea-dev' },
};

/** The dev TimescaleDB, the orders database with a hypertable, as the read-only role. */
export const devTimescale = {
  config: {
    ...devPostgres.config,
    port: Number(process.env.QUANTHEA_DEV_TIMESCALEDB_PORT ?? 5434),
  },
  secret: devPostgres.secret,
};

/** The dev TimescaleDB as the owner, which can write. */
export const devTimescaleOwner = {
  config: { ...devTimescale.config, username: 'quanthea_admin' },
  secret: { password: 'quanthea-dev' },
};

/**
 * A dev MySQL or MariaDB as the read-only user, in the MySQL connector's configuration shape.
 *
 * @param port - Its port.
 * @returns The configuration and the secret.
 */
function devMysqlOn(port: number) {
  return {
    config: { host: '127.0.0.1', port, database: 'orders', username: 'dash_ro', tls: 'disable' },
    secret: { password: 'dash-ro-dev' },
  };
}

/** The dev MySQL and MariaDB, each as the read-only user and as the owner, which can write. */
export const devMysqlServers = [
  { name: 'MySQL', port: Number(process.env.QUANTHEA_DEV_MYSQL_PORT ?? 3307) },
  { name: 'MariaDB', port: Number(process.env.QUANTHEA_DEV_MARIADB_PORT ?? 3308) },
].map(({ name, port }) => {
  const reader = devMysqlOn(port);
  const owner = {
    config: { ...reader.config, username: 'quanthea_admin' },
    secret: { password: 'quanthea-dev' },
  };
  return { name, reader, owner };
});

/**
 * The dev ClickHouse as a user, in the ClickHouse connector's configuration shape.
 *
 * @param username - The user: `dash_ro`, `dash_ro_2`, `dash_ro_1` or `quanthea_admin`.
 * @returns The configuration and the secret.
 */
export function devClickhouseAs(username: string) {
  const port = Number(process.env.QUANTHEA_DEV_CLICKHOUSE_PORT ?? 8124);
  return {
    config: { url: `http://127.0.0.1:${port}`, database: 'orders', username },
    secret: { password: username === 'quanthea_admin' ? 'quanthea-dev' : 'dash-ro-dev' },
  };
}

/** The dev Trino, whose catalog `orders` is the dev Postgres, in the connector's shape. */
export const devTrino = {
  config: {
    url: `http://127.0.0.1:${process.env.QUANTHEA_DEV_TRINO_PORT ?? 8081}`,
    catalog: 'orders',
    schema: 'public',
    username: 'dash_ro',
  },
  secret: {},
};

/** The dev Elasticsearch, without security, holding the request logs. */
export const devElasticsearch = {
  config: {
    url: `http://127.0.0.1:${process.env.QUANTHEA_DEV_ELASTICSEARCH_PORT ?? 9201}`,
    auth: 'none',
  },
  secret: {},
};

/** The dev OpenSearch, without security, holding the same logs. */
export const devOpensearch = {
  config: {
    url: `http://127.0.0.1:${process.env.QUANTHEA_DEV_OPENSEARCH_PORT ?? 9202}`,
    auth: 'none',
  },
  secret: {},
};

/** The dev Loki, holding the request logs. */
export const devLoki = {
  config: { url: `http://127.0.0.1:${process.env.QUANTHEA_DEV_LOKI_PORT ?? 3101}` },
  secret: {},
};

/** The dev HTTP API, with its token and its OpenAPI description. */
export const devHttpApi = {
  config: {
    url: `http://127.0.0.1:${process.env.QUANTHEA_DEV_HTTP_PORT ?? 8085}`,
    methods: 'GET and POST',
    paths: '/api/v1/**',
    openapi: '/openapi.json',
    auth: 'bearer',
  },
  secret: { token: 'dev-token' },
};

/** The dev InfluxDB 3, holding the request metrics of the incident. */
export const devInfluxdb = {
  config: {
    url: `http://127.0.0.1:${process.env.QUANTHEA_DEV_INFLUXDB_PORT ?? 8186}`,
    database: 'telemetry',
  },
  secret: { token: 'apiv3_quanthea-dev-token' },
};

/** The dev Valkey as the read-only ACL user. */
export const devValkey = {
  config: {
    host: '127.0.0.1',
    port: Number(process.env.QUANTHEA_DEV_VALKEY_PORT ?? 6380),
    username: 'dash_ro',
  },
  secret: { password: 'dash-ro-dev' },
};

/** The dev Valkey as the default user, which can write. */
export const devValkeyOwner = {
  config: { host: devValkey.config.host, port: devValkey.config.port },
  secret: { password: 'quanthea-dev' },
};

/** The dev MongoDB as the read-only user. */
export const devMongodb = {
  config: {
    host: '127.0.0.1',
    port: Number(process.env.QUANTHEA_DEV_MONGODB_PORT ?? 27018),
    database: 'shop',
    username: 'dash_ro',
    tls: 'disable',
  },
  secret: { password: 'dash-ro-dev' },
};

/** The dev MongoDB as the root user, which can write. */
export const devMongodbOwner = {
  config: { ...devMongodb.config, username: 'quanthea_admin', authSource: 'admin' },
  secret: { password: 'quanthea-dev' },
};

/** The dev Prometheus, in the Prometheus connector's configuration shape. */
export const devPrometheus = {
  config: { url: `http://127.0.0.1:${process.env.QUANTHEA_DEV_PROMETHEUS_PORT ?? 9091}` },
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
