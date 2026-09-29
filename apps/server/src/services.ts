/**
 * Builds the services over an open database: the configured connectors, the query executor and
 * the dashboards. The bootstrap and the tests wire them the same way.
 */

import type { DashboardSpec } from '@querent/shared';
import { type AccountDependencies, type Accounts, createAccounts } from './accounts.ts';
import { createMetadataWriter, type PinMetadata } from './agent/metadata.ts';
import { type Agent, createAgent } from './agent/run.ts';
import { resealIdentities, resealSignInCredentials, resealUsers } from './auth/reseal-users.ts';
import { type Connections, createConnections } from './connections/connections.ts';
import { resealConnectors } from './connections/reseal.ts';
import type { AnyConnectorKind } from './connectors/_shared/index.ts';
import { createDashboards, type Dashboards } from './dashboards/dashboards.ts';
import { createAuditRepository } from './db/audit-repository.ts';
import { createConnectorRepository } from './db/connector-repository.ts';
import { createDashboardRepository } from './db/dashboard-repository.ts';
import { createIdentityRepository } from './db/identity-repository.ts';
import { createProvisionedRepository } from './db/provisioned-repository.ts';
import { createThreadBinRepository } from './db/thread-bin.ts';
import { createThreadRepository } from './db/thread-repository.ts';
import { createUsageRepository } from './db/usage-repository.ts';
import { createUserRepository } from './db/user-repository.ts';
import { createModelView, type ModelView } from './gate/model-view.ts';
import { createManaged, type Managed } from './provisioning/managed.ts';
import { createQueryExecutor } from './query/executor.ts';
import { createResultCache } from './query/result-cache.ts';
import { type ChartSettingsService, createChartSettings } from './settings/chart-settings.ts';
import {
  createModelSettings,
  type ModelSettingsService,
  resealModelKeys,
} from './settings/model-settings.ts';
import { createQuerySettings, type QuerySettingsService } from './settings/query-settings.ts';
import {
  createRetentionSettings,
  type RetentionSettingsService,
} from './settings/retention-settings.ts';
import { createThreadBin, type ThreadBin } from './threads/bin.ts';
import { createThreads, type Threads } from './threads/threads.ts';
import { createUsage, type Usage } from './usage/usage.ts';

/** What the services need. */
export interface ServiceDependencies extends AccountDependencies {
  /** The connector kinds on offer. */
  readonly kinds: readonly AnyConnectorKind[];
}

/** The services the HTTP layer calls. */
export interface Services extends Accounts {
  /** What the configuration file manages. */
  readonly managed: Managed;
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
  /** The bin of threads. */
  readonly bin: ThreadBin;
  /**
   * Writes a dashboard's description and tags when it is pinned, with the metadata model of its
   * thread's provider; `null` when the model could not.
   */
  readonly describeForPin: (
    spec: DashboardSpec,
    dashboardId: string,
  ) => Promise<PinMetadata | null>;
  /** The agent that authors dashboards in threads. */
  readonly agent: Agent;
  /** The usage ledger. */
  readonly usage: Usage;
  /** The query settings. */
  readonly querySettings: QuerySettingsService;
  /** The chart settings. */
  readonly chartSettings: ChartSettingsService;
  /** How long deleted threads stay in the bin. */
  readonly retention: RetentionSettingsService;
}

/** How long a query result stays cached, in milliseconds. */
const resultTtlMs = 15_000;

/** How many query results the cache holds. */
const maxCachedResults = 500;

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
 * The metadata writer for a dashboard being pinned: with its thread's provider, and the usage
 * recorded against that thread.
 *
 * @param write - The metadata writer.
 * @param threads - The threads, for the provider.
 * @param bin - The bin, for the dashboard's thread.
 * @returns The describer.
 */
function pinDescriber(
  write: ReturnType<typeof createMetadataWriter>,
  threads: Threads,
  bin: ThreadBin,
): Services['describeForPin'] {
  return (spec, dashboardId) => {
    const owner = bin.ownerOf(dashboardId);
    const threadId = owner && !owner.binned ? owner.threadId : null;
    const providerId = threadId === null ? null : threads.row(threadId).providerId;
    return write({ spec, threadId, providerId });
  };
}

/**
 * Seals again every secret not sealed with the current key: connector credentials and model API
 * keys. Run at startup, so a rotated-out key can be dropped after one restart.
 *
 * @param dependencies - The database, the secret box and the settings.
 * @returns How many secrets were sealed again.
 */
export async function resealSecrets(
  dependencies: Pick<ServiceDependencies, 'database' | 'secretBox' | 'settings' | 'emailIndex'>,
): Promise<number> {
  const { database, secretBox, settings, emailIndex } = dependencies;
  const connectors = await resealConnectors(createConnectorRepository(database), secretBox);
  const users = await resealUsers(createUserRepository(database), secretBox, emailIndex);
  const identities = createIdentityRepository(database);
  const linked = await resealIdentities(identities, secretBox, emailIndex);
  const clients = await resealSignInCredentials(settings, secretBox);
  return (
    connectors + users + linked + clients + (await resealModelKeys({ store: settings, secretBox }))
  );
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
  const usage = createUsage({ repository: createUsageRepository(dependencies.database) });
  const modelSettings = createModelSettings({
    store: dependencies.settings,
    secretBox: dependencies.secretBox,
    audit,
    usage: () => usage.month(),
  });
  const querySettings = createQuerySettings({ store: dependencies.settings, audit });
  const threads = createThreads({ repository, audit });
  const accounts = createAccounts(dependencies, audit);
  const bin = createThreadBin({
    repository: createThreadBinRepository(dependencies.database),
    audit,
  });
  const chartSettings = createChartSettings({ store: dependencies.settings, audit });
  const retention = createRetentionSettings({ store: dependencies.settings, audit });
  const settings = { modelSettings, querySettings, chartSettings, retention };
  const agent = createAgent({ ...data, threads, usage, ...settings });
  const describeForPin = pinDescriber(createMetadataWriter({ modelSettings, usage }), threads, bin);
  const managed = createManaged(
    createProvisionedRepository(dependencies.database),
    dependencies.emailIndex,
  );
  return { ...data, threads, ...accounts, bin, describeForPin, agent, usage, ...settings, managed };
}
