/**
 * Builds the services over an open database: the configured connectors, the query executor and
 * the dashboards. The bootstrap and the tests wire them the same way.
 */
import { type Connections, createConnections } from './connections/connections.ts';
import type { AnyConnectorKind } from './connectors/_shared/index.ts';
import { createDashboards, type Dashboards } from './dashboards/dashboards.ts';
import { createAuditRepository } from './db/audit-repository.ts';
import { createConnectorRepository } from './db/connector-repository.ts';
import { createDashboardRepository } from './db/dashboard-repository.ts';
import type { openDatabase } from './db/database.ts';
import { createQueryExecutor } from './query/executor.ts';
import { createResultCache } from './query/result-cache.ts';
import type { SecretBox } from './secrets/secret-box.ts';

/** What the services need. */
export interface ServiceDependencies {
  /** A database the migrations have run on. */
  readonly database: ReturnType<typeof openDatabase>;
  /** The connector kinds on offer. */
  readonly kinds: readonly AnyConnectorKind[];
  /** Seals connector credentials. */
  readonly secretBox: SecretBox;
}

/** The services the HTTP layer calls. */
export interface Services {
  /** The configured connectors. */
  readonly connections: Connections;
  /** The dashboards. */
  readonly dashboards: Dashboards;
}

/** How long a query result stays cached, in milliseconds. */
const resultTtlMs = 15_000;

/** How many query results the cache holds. */
const maxCachedResults = 500;

/**
 * Creates the services.
 *
 * @param dependencies - The database, the connector kinds and the secret box.
 * @returns The services.
 */
export function createServices(dependencies: ServiceDependencies): Services {
  const { database, kinds, secretBox } = dependencies;
  const audit = createAuditRepository(database);
  const connections = createConnections({
    kinds,
    repository: createConnectorRepository(database),
    audit,
    secretBox,
  });
  const dashboards = createDashboards({
    repository: createDashboardRepository(database),
    audit,
    lookup: connections.lookup,
    openSource: async (name) => (await connections.open(name)).source,
    executor: createQueryExecutor(
      createResultCache({ ttlMs: resultTtlMs, maxEntries: maxCachedResults }),
    ),
  });
  return { connections, dashboards };
}
