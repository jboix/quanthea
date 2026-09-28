/** The connector endpoints: kinds, configured connectors, connection tests and schemas. Admin only. */
import {
  createConnectorEndpoint,
  deleteConnectorEndpoint,
  getConnectorEndpoint,
  getConnectorSchemaEndpoint,
  listConnectorKindsEndpoint,
  listConnectorsEndpoint,
  type Principal,
  refreshConnectorSchemaEndpoint,
  testConnectorEndpoint,
  updateConnectorEndpoint,
} from '@querent/shared';
import type { Hono } from 'hono';
import type { Connections } from '../../connections/connections.ts';
import type { AppEnv } from '../app-env.ts';
import { mountEndpoint } from '../endpoint.ts';

/**
 * The actor recorded in the audit log. Admin routes only run with a principal.
 *
 * @param principal - The request's principal.
 * @returns The principal id.
 */
function actorOf(principal: Principal | null): string {
  return principal?.id ?? 'unknown';
}

/**
 * Mounts the endpoints that read and change connector settings.
 *
 * @param app - The app.
 * @param connections - The connectors service.
 */
function mountSettingsRoutes(app: Hono<AppEnv>, connections: Connections): void {
  mountEndpoint(app, listConnectorKindsEndpoint, {
    access: 'admin',
    handle: () => connections.kinds(),
  });
  mountEndpoint(app, listConnectorsEndpoint, { access: 'admin', handle: () => connections.list() });
  mountEndpoint(app, createConnectorEndpoint, {
    access: 'admin',
    handle: ({ body, principal }) => connections.create(body, actorOf(principal)),
  });
  mountEndpoint(app, getConnectorEndpoint, {
    access: 'admin',
    handle: ({ params }) => connections.get(params.connectorId),
  });
  mountEndpoint(app, updateConnectorEndpoint, {
    access: 'admin',
    handle: ({ params, body, principal }) =>
      connections.update(params.connectorId, body, actorOf(principal)),
  });
  mountEndpoint(app, deleteConnectorEndpoint, {
    access: 'admin',
    handle: async ({ params, principal }) => {
      await connections.remove(params.connectorId, actorOf(principal));
      return { deleted: true as const };
    },
  });
}

/**
 * Mounts the endpoints that talk to the source: the connection test and the schema.
 *
 * @param app - The app.
 * @param connections - The connectors service.
 */
function mountSourceRoutes(app: Hono<AppEnv>, connections: Connections): void {
  mountEndpoint(app, testConnectorEndpoint, {
    access: 'admin',
    handle: ({ params, signal }) => connections.test(params.connectorId, signal),
  });
  mountEndpoint(app, getConnectorSchemaEndpoint, {
    access: 'admin',
    handle: ({ params }) => connections.schema(params.connectorId),
  });
  mountEndpoint(app, refreshConnectorSchemaEndpoint, {
    access: 'admin',
    handle: ({ params, signal }) => connections.refreshSchema(params.connectorId, signal),
  });
}

/**
 * Mounts every connector endpoint. All of them need the admin role.
 *
 * @param app - The app.
 * @param connections - The connectors service.
 */
export function mountConnectorRoutes(app: Hono<AppEnv>, connections: Connections): void {
  mountSettingsRoutes(app, connections);
  mountSourceRoutes(app, connections);
}
