/** The connector endpoints: kinds, configured connectors, connection tests and schemas. Admin only. */
import {
  countAffectedThreadsEndpoint,
  countObjectUsageEndpoint,
  createConnectorEndpoint,
  deleteConnectorEndpoint,
  getConnectorEndpoint,
  getConnectorSchemaEndpoint,
  listConnectorKindsEndpoint,
  listConnectorsEndpoint,
  refreshConnectorSchemaEndpoint,
  testConnectorEndpoint,
  updateConnectorEndpoint,
} from '@quanthea/shared';
import type { Hono } from 'hono';
import type { Connections } from '../../connections/connections.ts';
import type { Dashboards } from '../../dashboards/dashboards.ts';
import { countNarrowedThreads } from '../../gate/source-access.ts';
import type { Managed } from '../../provisioning/managed.ts';
import type { Threads } from '../../threads/threads.ts';
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
 * Mounts the endpoint that counts the threads an access change would restrict, before it is
 * saved: they hold data the change no longer lets through, which continuing them resends.
 *
 * @param app - The app.
 * @param connections - The connectors service.
 * @param threads - The threads, for the access their runs recorded.
 */
function mountAccessChangeRoute(
  app: Hono<AppEnv>,
  connections: Connections,
  threads: Pick<Threads, 'sourceAccess'>,
): void {
  mountEndpoint(app, countAffectedThreadsEndpoint, {
    access: 'admin',
    handle: async ({ params, body }) => {
      const { id } = await connections.get(params.connectorId);
      return { threads: countNarrowedThreads(threads.sourceAccess(), id, body) };
    },
  });
}

/**
 * Mounts the endpoint that counts the threads and pinned dashboards reading an object that a
 * change of what the connector shows would hide, before it is saved.
 *
 * @param app - The app.
 * @param connections - The connectors service.
 * @param dashboards - The dashboards, for the specs that name the connector.
 */
function mountObjectUsageRoute(
  app: Hono<AppEnv>,
  connections: Connections,
  dashboards: Pick<Dashboards, 'objectUsage'>,
): void {
  mountEndpoint(app, countObjectUsageEndpoint, {
    access: 'admin',
    handle: ({ params, body }) =>
      dashboards.objectUsage(connections.visibilityChange(params.connectorId, body)),
  });
}

/** The services whose records say what a change to a connector touches. */
export interface ConnectorUsage {
  /** The threads, for the access their runs recorded. */
  readonly threads: Pick<Threads, 'sourceAccess'>;
  /** The dashboards, for the specs that name a connector. */
  readonly dashboards: Pick<Dashboards, 'objectUsage'>;
}

/**
 * Mounts every connector endpoint. All of them need the admin role.
 *
 * @param app - The app.
 * @param connections - The connectors service.
 * @param managed - What the configuration file manages.
 * @param usage - The threads and dashboards a change is counted in.
 */
export function mountConnectorRoutes(
  app: Hono<AppEnv>,
  connections: Connections,
  managed: Managed,
  usage: ConnectorUsage,
): void {
  mountSettingsRoutes(app, connections, managed);
  mountSourceRoutes(app, connections);
  mountAccessChangeRoute(app, connections, usage.threads);
  mountObjectUsageRoute(app, connections, usage.dashboards);
}
