/** The connector endpoints: kinds, configured connectors, connection tests and schemas. Admin only. */
import {
  createConnectorEndpoint,
  deleteConnectorEndpoint,
  getConnectorEndpoint,
  getConnectorSchemaEndpoint,
  listConnectorKindsEndpoint,
  listConnectorsEndpoint,
  refreshConnectorSchemaEndpoint,
  testConnectorEndpoint,
  updateConnectorEndpoint,
} from '@querent/shared';
import type { Hono } from 'hono';
import type { Connections } from '../../connections/connections.ts';
import type { Managed } from '../../provisioning/managed.ts';
import type { AppEnv } from '../app-env.ts';
import { mountEndpoint } from '../endpoint.ts';
import { actorOf } from '../principal.ts';

/**
 * A connector with the file that manages it, when one does.
 *
 * @param managed - What the configuration file manages.
 * @returns A function marking one connector.
 */
function marker(managed: Managed) {
  return <Connector extends { readonly name: string }>(connector: Connector) => {
    const path = managed.pathOf('connector', connector.name);
    return path ? { ...connector, managedBy: path } : connector;
  };
}

/**
 * Mounts the admin routes that read and change connectors. A connector the configuration file
 * manages is read-only, except the fields the file leaves to the interface.
 *
 * @param app - The app.
 * @param connections - The connections.
 * @param managed - What the configuration file manages.
 */
function mountSettingsRoutes(app: Hono<AppEnv>, connections: Connections, managed: Managed): void {
  const mark = marker(managed);
  mountEndpoint(app, listConnectorKindsEndpoint, {
    access: 'admin',
    handle: () => connections.kinds(),
  });
  mountEndpoint(app, listConnectorsEndpoint, {
    access: 'admin',
    handle: () => connections.list().map(mark),
  });
  mountEndpoint(app, createConnectorEndpoint, {
    access: 'admin',
    handle: ({ body, principal }) => connections.create(body, actorOf(principal)),
  });
  mountEndpoint(app, getConnectorEndpoint, {
    access: 'admin',
    handle: async ({ params }) => mark(await connections.get(params.connectorId)),
  });
  mountChangeRoutes(app, connections, managed);
}

/**
 * Mounts the routes that change or delete a connector, refusing what the file manages.
 *
 * @param app - The app.
 * @param connections - The connections.
 * @param managed - What the configuration file manages.
 */
function mountChangeRoutes(app: Hono<AppEnv>, connections: Connections, managed: Managed): void {
  const nameOf = async (id: string) => (await connections.get(id)).name;
  mountEndpoint(app, updateConnectorEndpoint, {
    access: 'admin',
    handle: async ({ params, body, principal }) => {
      managed.refuseChange('connector', await nameOf(params.connectorId), Object.keys(body));
      return connections.update(params.connectorId, body, actorOf(principal));
    },
  });
  mountEndpoint(app, deleteConnectorEndpoint, {
    access: 'admin',
    handle: async ({ params, principal }) => {
      managed.refuseChange('connector', await nameOf(params.connectorId));
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
 * @param managed - What the configuration file manages.
 */
export function mountConnectorRoutes(
  app: Hono<AppEnv>,
  connections: Connections,
  managed: Managed,
): void {
  mountSettingsRoutes(app, connections, managed);
  mountSourceRoutes(app, connections);
}
