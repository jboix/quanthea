/**
 * Builds the services over an open database: the configured connectors, the query executor and
 * the dashboards. The bootstrap and the tests wire them the same way.
 */

import type { AuthMode, DashboardSpec } from '@querent/shared';
import { createMetadataWriter, type PinMetadata } from './agent/metadata.ts';
import { type Agent, createAgent } from './agent/run.ts';
import { type AuthModeControl, createAuthModeControl } from './auth/auth-mode-control.ts';
import { createPasswordAccounts, type PasswordAccounts } from './auth/password-accounts.ts';
import type { HashCosts } from './auth/passwords.ts';
import { resealUsers } from './auth/reseal-users.ts';
import { createSessions, type Sessions } from './auth/sessions.ts';
import { accountRule, addressRule, createThrottle } from './auth/throttle.ts';
import type { UserAdminDependencies } from './auth/user-admin.ts';
import { createUsers, type Users } from './auth/users.ts';
import { type Connections, createConnections } from './connections/connections.ts';
import { resealConnectors } from './connections/reseal.ts';
import type { AnyConnectorKind } from './connectors/_shared/index.ts';
import { createDashboards, type Dashboards } from './dashboards/dashboards.ts';
import { createAuditRepository } from './db/audit-repository.ts';
import { createConnectorRepository } from './db/connector-repository.ts';
import { createDashboardRepository } from './db/dashboard-repository.ts';
import type { openDatabase } from './db/database.ts';
import { createPasswordLinkRepository } from './db/password-link-repository.ts';
import { createSessionRepository } from './db/session-repository.ts';
import { createThreadBinRepository } from './db/thread-bin.ts';
import { createThreadOwnershipRepository } from './db/thread-ownership.ts';
import { createThreadRepository } from './db/thread-repository.ts';
import { createUsageRepository } from './db/usage-repository.ts';
import { createUserRepository, type UserRepository } from './db/user-repository.ts';
import { createModelView, type ModelView } from './gate/model-view.ts';
import { createQueryExecutor } from './query/executor.ts';
import { createResultCache } from './query/result-cache.ts';
import type { KeyedHash } from './secrets/keyed-hash.ts';
import type { Peppers, SessionHashes } from './secrets/keys.ts';
import type { SecretBox } from './secrets/secret-box.ts';
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
import type { SettingsStore } from './settings/settings-store.ts';
import { createThreadBin, type ThreadBin } from './threads/bin.ts';
import { createThreads, type Threads } from './threads/threads.ts';
import { createUsage, type Usage } from './usage/usage.ts';

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
  /** Indexes emails, under a key derived from the secret key. */
  readonly emailIndex: KeyedHash;
  /** The session key's hashes; without them there are no sessions, as in `none` mode. */
  readonly sessionHashes: SessionHashes | undefined;
  /** The peppers; without them there are no passwords. */
  readonly peppers: Peppers | undefined;
  /** The argon2id costs; lower in tests only. */
  readonly passwordCosts?: HashCosts;
  /** The mode `QUERENT_AUTH_MODE` forces, if set. */
  readonly authOverride?: AuthMode | undefined;
  /** What the server lacks for accounts, found at startup; none by default. */
  readonly accountsProblems?: readonly string[];
  /** The clock of the users and sessions; `Date.now` by default. */
  readonly now?: () => number;
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
  /** The people who sign in. */
  readonly users: Users;
  /** Sessions, when the session key is set. */
  readonly sessions: Sessions | undefined;
  /** Password accounts, when the session key and the pepper are set. */
  readonly passwords: PasswordAccounts | undefined;
  /** What changing a user needs. */
  readonly userAdmin: UserAdminDependencies;
  /** The authentication mode, switched without a restart. */
  readonly authMode: AuthModeControl;
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
  return connectors + users + (await resealModelKeys({ store: settings, secretBox }));
}

/**
 * The users, and the sessions when the session key is set.
 *
 * @param dependencies - The database, the secret box and the keyed hashes.
 * @param audit - The audit log.
 * @returns The services.
 */
function accountServices(
  dependencies: ServiceDependencies,
  audit: ReturnType<typeof createAuditRepository>,
) {
  const { database, secretBox, emailIndex, sessionHashes } = dependencies;
  const clock = dependencies.now ? { now: dependencies.now } : {};
  const repository = createUserRepository(database);
  const users = createUsers({ repository, secretBox, emailIndex, audit, ...clock });
  const sessionRepository = createSessionRepository(database);
  const sessions =
    sessionHashes && createSessions({ repository: sessionRepository, ...sessionHashes, ...clock });
  const passwords = passwordServices(dependencies, { users: repository, sessions, audit });
  const authMode = createAuthModeControl({
    settings: dependencies.settings,
    override: dependencies.authOverride,
    problems: dependencies.accountsProblems ?? [],
    users: repository,
    names: users,
    threads: createThreadOwnershipRepository(database),
    sessions,
    audit,
  });
  const userAdmin = { repository, sessions, audit, ...clock };
  return { users, sessions, passwords, userAdmin, authMode };
}

/**
 * Password accounts, when the session key and the pepper are set.
 *
 * @param dependencies - The database, the secret box, the keys, the costs and the clock.
 * @param parts - The users, the sessions and the audit log.
 * @param parts.users - The users' repository.
 * @param parts.sessions - The sessions, if any.
 * @param parts.audit - The audit log.
 * @returns The password accounts, or `undefined`.
 */
function passwordServices(
  dependencies: ServiceDependencies,
  parts: {
    users: UserRepository;
    sessions: Sessions | undefined;
    audit: ReturnType<typeof createAuditRepository>;
  },
): PasswordAccounts | undefined {
  const { sessionHashes, peppers, now } = dependencies;
  if (!sessionHashes || !peppers || !parts.sessions) return undefined;
  return createPasswordAccounts({
    ...parts,
    sessions: parts.sessions,
    secretBox: dependencies.secretBox,
    emailIndex: dependencies.emailIndex,
    links: createPasswordLinkRepository(dependencies.database),
    tokenHash: sessionHashes.tokenHash,
    peppers,
    addresses: createThrottle(addressRule, now),
    accounts: createThrottle(accountRule, now),
    ...(dependencies.passwordCosts ? { costs: dependencies.passwordCosts } : {}),
    ...(now ? { now } : {}),
  });
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
  const accounts = accountServices(dependencies, audit);
  const bin = createThreadBin({
    repository: createThreadBinRepository(dependencies.database),
    audit,
  });
  const chartSettings = createChartSettings({ store: dependencies.settings, audit });
  const retention = createRetentionSettings({ store: dependencies.settings, audit });
  const settings = { modelSettings, querySettings, chartSettings, retention };
  const agent = createAgent({ ...data, threads, usage, ...settings });
  const describeForPin = pinDescriber(createMetadataWriter({ modelSettings, usage }), threads, bin);
  return { ...data, threads, ...accounts, bin, describeForPin, agent, usage, ...settings };
}
