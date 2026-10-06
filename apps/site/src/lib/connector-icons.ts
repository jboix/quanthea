/**
 * The icon of each data source on the connectors wall. Most are the project's mark from Simple
 * Icons (CC0), read from the `simple-icons` package at build time, so the site commits no logo.
 * The sources it has no mark for get a plain glyph drawn here. Every icon takes the text colour.
 */
import {
  siClickhouse,
  siElasticsearch,
  siInfluxdb,
  siMariadb,
  siMongodb,
  siMysql,
  siOpensearch,
  siPostgresql,
  siPrometheus,
  siTimescale,
  siTrino,
} from 'simple-icons';

/** An icon on a 24 by 24 grid: a filled shape, or lines drawn with a stroke. */
export interface ConnectorIcon {
  /** The path data. */
  readonly path: string;
  /** Whether the path is filled (a project's mark) or stroked (a glyph drawn here). */
  readonly style: 'fill' | 'stroke';
}

/** Log lines of different lengths: for Loki, which Simple Icons has no mark for. */
const logLines = 'M4 6h16M4 10h11M4 14h14M4 18h8';

/** A key beside a stored value: for Valkey. */
const keyValue = 'M7 14a3 3 0 1 1 0-6 3 3 0 0 1 0 6zM10 11h4M14 11v3M13 7h7v8h-7';

/** Braces around a request: for HTTP APIs. */
const braces =
  'M8 4c-2 0-2 1.5-2 3v2c0 1.5-1 3-2 3 1 0 2 1.5 2 3v2c0 1.5 0 3 2 3M16 4c2 0 2 1.5 2 3v2c0 1.5 1 3 2 3-1 0-2 1.5-2 3v2c0 1.5 0 3-2 3';

/** The icon of each source, by its display name in `facts.ts`. */
const icons: Readonly<Record<string, ConnectorIcon>> = {
  Prometheus: { path: siPrometheus.path, style: 'fill' },
  Loki: { path: logLines, style: 'stroke' },
  InfluxDB: { path: siInfluxdb.path, style: 'fill' },
  PostgreSQL: { path: siPostgresql.path, style: 'fill' },
  TimescaleDB: { path: siTimescale.path, style: 'fill' },
  MySQL: { path: siMysql.path, style: 'fill' },
  MariaDB: { path: siMariadb.path, style: 'fill' },
  ClickHouse: { path: siClickhouse.path, style: 'fill' },
  Trino: { path: siTrino.path, style: 'fill' },
  Elasticsearch: { path: siElasticsearch.path, style: 'fill' },
  OpenSearch: { path: siOpensearch.path, style: 'fill' },
  Valkey: { path: keyValue, style: 'stroke' },
  MongoDB: { path: siMongodb.path, style: 'fill' },
  'HTTP APIs': { path: braces, style: 'stroke' },
};

/**
 * The icon of a source.
 *
 * @param name - The source's display name, as in `facts.ts`.
 * @returns Its icon, or `undefined` for a source without one.
 */
export function connectorIcon(name: string): ConnectorIcon | undefined {
  return icons[name];
}
