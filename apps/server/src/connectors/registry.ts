/**
 * Every connector kind the app offers. To add a kind, create `connectors/<kind>/` with a
 * `defineConnector` declaration and list it here; the forms, the API and the gate pick it up.
 */
import type { AnyConnectorKind } from './_shared/index.ts';
import { clickhouseConnector } from './clickhouse/clickhouse-connector.ts';
import { httpConnector } from './http/http-connector.ts';
import { influxdbConnector } from './influxdb/influxdb-connector.ts';
import { lokiConnector } from './loki/loki-connector.ts';
import { mongodbConnector } from './mongodb/mongodb-connector.ts';
import { mariadbConnector } from './mysql/mariadb-connector.ts';
import { mysqlConnector } from './mysql/mysql-connector.ts';
import { postgresConnector } from './postgres/postgres-connector.ts';
import { prometheusConnector } from './prometheus/prometheus-connector.ts';
import { elasticsearchConnector } from './search/elasticsearch-connector.ts';
import { opensearchConnector } from './search/opensearch-connector.ts';
import { trinoConnector } from './trino/trino-connector.ts';
import { valkeyConnector } from './valkey/valkey-connector.ts';

/** The connector kinds, in the order the add form lists them. */
export const connectorKinds: readonly AnyConnectorKind[] = [
  postgresConnector,
  mysqlConnector,
  mariadbConnector,
  clickhouseConnector,
  trinoConnector,
  prometheusConnector,
  influxdbConnector,
  elasticsearchConnector,
  opensearchConnector,
  lokiConnector,
  valkeyConnector,
  mongodbConnector,
  httpConnector,
];

/**
 * Finds a connector kind by identifier.
 *
 * @param kind - The identifier stored with a connector, such as `postgres`.
 * @returns The kind, or `undefined` when no kind has that identifier.
 */
export function findConnectorKind(kind: string): AnyConnectorKind | undefined {
  return connectorKinds.find((candidate) => candidate.kind === kind);
}
