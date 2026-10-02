/**
 * What each choice shows in the prompts: the value, then what it means in plain words. The flags
 * take the bare value; these labels only help someone choosing in the terminal.
 */
import type {
  QueryLanguage,
  sqlDialects,
  sqlPlaceholderStyles,
  sqlRowLimits,
} from '@quanthea/plugin-kit/contract';

/** The query languages, by who speaks them. */
export const languageLabels: Readonly<Record<QueryLanguage, string>> = {
  sql: 'SQL: PostgreSQL, MySQL, DuckDB, Snowflake, SQL Server and other databases',
  promql: 'PromQL: Prometheus and the databases that speak it',
  search: 'Search queries: Elasticsearch and OpenSearch',
  logql: 'LogQL: Grafana Loki',
  http: 'HTTP: an API that answers with JSON',
  redis: 'Redis commands: Redis and Valkey',
  mongodb: 'MongoDB aggregation pipelines',
};

/** The SQL dialects, by the databases they fit. */
export const dialectLabels: Readonly<Record<(typeof sqlDialects)[number], string>> = {
  postgres: 'PostgreSQL, or a database that speaks its SQL, such as TimescaleDB',
  mysql: 'MySQL or MariaDB',
  clickhouse: 'ClickHouse',
  trino: 'Trino',
  influxdb: 'InfluxDB 3',
  ansi: 'Standard SQL: any other database (two more questions follow)',
};

/** The placeholder styles, each with an example and the drivers that write it. */
export const placeholderLabels: Readonly<Record<(typeof sqlPlaceholderStyles)[number], string>> = {
  '?': 'WHERE id = ?     JDBC and ODBC drivers, SQLite, DuckDB, Snowflake',
  $1: 'WHERE id = $1    numbered, as PostgreSQL drivers write it',
  ':1': 'WHERE id = :1    numbered, as Oracle drivers write it',
  '@p1': 'WHERE id = @p1   named, as SQL Server drivers write it',
};

/** The row-limit styles, each with an example and databases that use it. */
export const rowLimitLabels: Readonly<Record<(typeof sqlRowLimits)[number], string>> = {
  fetch: 'FETCH FIRST 100 ROWS ONLY   the SQL standard: Oracle, DB2',
  limit: 'LIMIT 100                   SQLite, DuckDB, MySQL',
};
