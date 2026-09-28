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
import { createThreadRepository } from './db/thread-repository.ts';
import { createModelView, type ModelView } from './gate/model-view.ts';
import { createQueryExecutor } from './query/executor.ts';
import { createResultCache } from './query/result-cache.ts';
import type { SecretBox } from './secrets/secret-box.ts';
import { createModelSettings, type ModelSettingsService } from './settings/model-settings.ts';
import type { SettingsStore } from './settings/settings-store.ts';
import { createThreads, type Threads } from './threads/threads.ts';

/** What the services need. */
export interface ServiceDependencies {
  /** A database the migrations have run on. */
  readonly database: ReturnType<typeof openDatabase>;
  /** The connector kinds on offer. */
  readonly kinds: readonly AnyConnectorKind[];
  /** Seals connector credentials and the model key. */
  readonly secretBox: SecretBox;
  /** The settings store. */
  readonly settings: SettingsStore;
}

/** The services the HTTP layer calls. */
export interface Services {
  /** The configured connectors. */
  readonly connections: Connections;
  /** The dashboards. */
  readonly dashboards: Dashboards;
  /** The model gateway settings. */
  readonly modelSettings: ModelSettingsService;
  /** The connectors as the model sees them, through the gate. */
  readonly modelView: ModelView;
  /** The threads. */
  readonly threads: Threads;
}

/** How long a query result stays cached, in milliseconds. */
const resultTtlMs = 15_000;

/** How many query results the cache holds. */
const maxCachedResults = 500;

/**
 * The first instant of the current month, in UTC.
 *
 * @returns Epoch milliseconds.
 */
function monthStart(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
}

/**
 * The services over the data sources: connectors, the query executor, dashboards and the
 * model's view of the connectors, which share one executor and its cache.
 *
 * @param dependencies - The database, the connector kinds and the secret box.
 * @param audit - The audit log.
 * @returns The data services.
 */
function dataServices(
  dependencies: ServiceDependencies,
  audit: ReturnType<typeof createAuditRepository>,
) {
  const { database, kinds, secretBox } = dependencies;
  const repository = createConnectorRepository(database);
  const connections = createConnections({ kinds, repository, audit, secretBox });
  const executor = createQueryExecutor(
    createResultCache({ ttlMs: resultTtlMs, maxEntries: maxCachedResults }),
  );
  const dashboards = createDashboards({
    repository: createDashboardRepository(database),
    audit,
    lookup: connections.lookup,
    openSource: async (name) => (await connections.open(name)).source,
    executor,
  });
  const { subjects: list, open, snapshot } = connections;
  const modelView = createModelView({ list, open, snapshot }, executor);
  return { connections, dashboards, modelView };
}

/**
 * Creates the services.
 *
 * @param dependencies - The database, the connector kinds, the secret box and the settings.
 * @returns The services.
 */
export function createServices(dependencies: ServiceDependencies): Services {
  const audit = createAuditRepository(dependencies.database);
  const data = dataServices(dependencies, audit);
  const repository = createThreadRepository(dependencies.database);
  const modelSettings = createModelSettings({
    store: dependencies.settings,
    secretBox: dependencies.secretBox,
    audit,
    usage: () => repository.usageSince(monthStart()),
  });
  return { ...data, modelSettings, threads: createThreads({ repository, audit }) };
}
