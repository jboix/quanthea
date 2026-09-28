/**
 * Every connector kind the app offers. To add a kind, create `connectors/<kind>/` with a
 * `defineConnector` declaration and list it here; the forms, the API and the gate pick it up.
 */
import type { AnyConnectorKind } from './_shared/index.ts';
import { postgresConnector } from './postgres/postgres-connector.ts';
import { prometheusConnector } from './prometheus/prometheus-connector.ts';

/** The connector kinds, in the order the add form lists them. */
export const connectorKinds: readonly AnyConnectorKind[] = [postgresConnector, prometheusConnector];

/**
 * Finds a connector kind by identifier.
 *
 * @param kind - The identifier stored with a connector, such as `postgres`.
 * @returns The kind, or `undefined` when no kind has that identifier.
 */
export function findConnectorKind(kind: string): AnyConnectorKind | undefined {
  return connectorKinds.find((candidate) => candidate.kind === kind);
}
