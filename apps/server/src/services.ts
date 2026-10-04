/**
 * Builds the services over an open database: the configured connectors, the query executor and
 * the dashboards. The bootstrap and the tests wire them the same way.
 */

import type { DashboardSpec, Notification } from '@quanthea/shared';
import { type AccountDependencies, type Accounts, createAccounts } from './accounts.ts';
import { createAnswers } from './agent/answer.ts';
import type { Answers } from './agent/answer-types.ts';
import { createMetadataWriter, type PinMetadata } from './agent/metadata.ts';
import { type Agent, createAgent } from './agent/run.ts';
import { type Alerts, createAlerts } from './alerts/alerts.ts';
import type { EvaluationDependencies } from './alerts/evaluate.ts';
import { createPanelLinks, type PanelLinks } from './alerts/links.ts';
import { resealIdentities, resealSignInCredentials, resealUsers } from './auth/reseal-users.ts';
import { type Connections, createConnections } from './connections/connections.ts';
import { resealConnectors } from './connections/reseal.ts';
import type { RegisteredKind } from './connectors/_shared/index.ts';
import { type ConversationBins, combineConversationBins } from './conversation-bins.ts';
import type { DashboardsDependencies } from './dashboards/context.ts';
import { type ConversationBin, createConversationBin } from './dashboards/conversation-bin.ts';
import { createDashboards, type Dashboards } from './dashboards/dashboards.ts';
import { createExplanations, type Explanations } from './dashboards/explanations.ts';
import { createQuestions, type Questions } from './dashboards/questions.ts';
import { createSnapshots, type Snapshots } from './dashboards/snapshots.ts';
import { createAlertActivityRepository } from './db/alert-activity.ts';
import { createAlertChannelUsage } from './db/alert-channel-usage.ts';
import { createAlertLinkRepository } from './db/alert-link-repository.ts';
import { createAlertRepository } from './db/alert-repository.ts';
import { createAlertStateRepository } from './db/alert-state-repository.ts';
import { createAuditRepository } from './db/audit-repository.ts';
import { createChannelRepository } from './db/channel-repository.ts';
import { createConnectorRepository } from './db/connector-repository.ts';
import { createConversationBinRepository } from './db/conversation-bin.ts';
import { createDashboardRepository } from './db/dashboard-repository.ts';
import { createExplanationRepository } from './db/explanation-repository.ts';
import { createIdentityRepository } from './db/identity-repository.ts';
import { createProvisionedRepository } from './db/provisioned-repository.ts';
import { createQuestionRepository } from './db/question-repository.ts';
import { createReportChannelUsage } from './db/report-channel-usage.ts';
import { createSnapshotRepository } from './db/snapshot-repository.ts';
import { createThreadBinRepository } from './db/thread-bin.ts';
import { createThreadRepository } from './db/thread-repository.ts';
import { createUsageRepository } from './db/usage-repository.ts';
import { createUserRepository } from './db/user-repository.ts';
import { createModelView, type ModelView } from './gate/model-view.ts';
import { createNotifications, type Notifications } from './notifications/notifications.ts';
import { resealChannels } from './notifications/reseal.ts';
import { createManaged, type Managed } from './provisioning/managed.ts';
import { createQueryExecutor } from './query/executor.ts';
import { createResultCache } from './query/result-cache.ts';
import {
  createReportServices,
  type ReportServiceDependencies,
  type ReportServices,
} from './report-services.ts';
import { type AlertSettingsService, createAlertSettings } from './settings/alert-settings.ts';
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
  readonly kinds: readonly RegisteredKind[];
}

/** The services the HTTP layer calls. */
export interface Services extends Accounts, ReportServices {
  /** What the configuration file manages. */
  readonly managed: Managed;
  /** The configured connectors. */
  readonly connections: Connections;
  /** The dashboards. */
  readonly dashboards: Dashboards;
  /** Snapshots of dashboards, frozen with their results. */
  readonly snapshots: Snapshots;
  /** Questions asked about dashboards, stored with their answers. */
  readonly questions: Questions;
  /** Explanations of panels, kept per version and panel. */
  readonly explanations: Explanations;
  /** The bins of conversations about dashboards and about reports' runs. */
  readonly conversationBin: ConversationBins;
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
  /** Answers questions about a dashboard and explains its panels. */
  readonly answers: Answers;
  /** The usage ledger. */
  readonly usage: Usage;
  /** The query settings. */
  readonly querySettings: QuerySettingsService;
  /** The chart settings. */
  readonly chartSettings: ChartSettingsService;
  /** How long deleted threads stay in the bin. */
  readonly retention: RetentionSettingsService;
  /** The notification channels, and sending to them. */
  readonly notifications: Notifications;
  /** Alerts: their versions, state, mutes and replays. */
  readonly alerts: Alerts;
  /** The links between alerts and dashboard panels, and the suggestions. */
  readonly panelLinks: PanelLinks;
  /** How many alerts may be active per connector. */
  readonly alertSettings: AlertSettingsService;
  /** What the alert evaluator needs to evaluate one alert, but the logger. */
  readonly alertEvaluation: Omit<EvaluationDependencies, 'logger'>;
}

/** How long a query result stays cached, in milliseconds. */
const resultTtlMs = 15_000;

/** How many query results the cache holds. */
const maxCachedResults = 500;

/**
 * How the dashboards reach the data sources: the connector lookup, an opener and the executor.
 *
 * @param connections - The connections.
 * @param executor - The shared query executor.
 * @returns The lookup, the opener and the executor.
 */
function sourcesOf(
  connections: ReturnType<typeof createConnections>,
  executor: ReturnType<typeof createQueryExecutor>,
) {
  return {
    lookup: connections.lookup,
    openSource: async (name: string) => (await connections.open(name)).source,
    executor,
  };
}

/**
 * The services over the data sources: connectors, the query executor, dashboards, their snapshots,
 * questions and explanations, and the model's view of the connectors, which share one executor
 * and its cache. They run on the same clock as the accounts, so a test or the evals can fix
 * the time.
 *
 * @param dependencies - The database, the connector kinds, the secret box and the clock.
 * @param audit - The audit log.
 * @returns The data services, and the notification channels the alerts send to.
 */
function dataServices(
  dependencies: ServiceDependencies,
  audit: ReturnType<typeof createAuditRepository>,
) {
  const { database, kinds, secretBox, now } = dependencies;
  const repository = createConnectorRepository(database);
  const connections = createConnections({ kinds, repository, audit, secretBox });
  const executor = createQueryExecutor(
    createResultCache({ ttlMs: resultTtlMs, maxEntries: maxCachedResults }),
  );
  const dashboardDependencies = {
    ...sourcesOf(connections, executor),
    repository: createDashboardRepository(database),
    audit,
    ...(now ? { now } : {}),
  };
  const dashboards = createDashboards(dashboardDependencies);
  const snapshots = createSnapshots({
    ...dashboardDependencies,
    snapshots: createSnapshotRepository(database),
  });
  const { subjects: list, open, snapshot } = connections;
  const modelView = createModelView({ list, open, snapshot }, executor);
  const answered = answerServices(database, dashboardDependencies, modelView);
  const { runConversationBin, ...messaging } = messagingServices(dependencies, audit, {
    ...dashboardDependencies,
    dashboards,
    connectorLevels: () => modelView.connectors(),
  });
  const conversationBin = combineConversationBins(answered.conversationBin, runConversationBin);
  const data = { connections, dashboards, snapshots, modelView, ...messaging };
  return { ...data, ...answered, conversationBin };
}

/**
 * The services that send messages: the notification channels, the alerts and the reports. They
 * share the panels' connectors and executor.
 *
 * @param dependencies - The database, the settings store and the public URL.
 * @param audit - The audit log.
 * @param shared - The connectors and the executor the dashboards use, and the dashboards.
 * @returns The channels, the alerts and the reports with their settings.
 */
function messagingServices(
  dependencies: ServiceDependencies,
  audit: ReturnType<typeof createAuditRepository>,
  shared: DashboardsDependencies & {
    readonly dashboards: Dashboards;
    readonly connectorLevels: ReportServiceDependencies['connectorLevels'];
  },
) {
  const notifications = notificationService(dependencies, audit);
  const alerting = alertServices(dependencies, audit, { ...shared, notifications });
  const { database, settings, publicUrl } = dependencies;
  const reporting = createReportServices({
    ...{ ...shared, database, settings, publicUrl, audit, notifications },
    alertSettings: alerting.alertSettings,
  });
  return { notifications, ...alerting, ...reporting };
}

/**
 * The alerts, their settings, and what evaluating one needs. They share the panels' executor.
 *
 * @param dependencies - The database, the settings store and the public URL.
 * @param audit - The audit log.
 * @param shared - The connectors and the executor the dashboards use, and the channels.
 * @returns The services.
 */
function alertServices(
  dependencies: ServiceDependencies,
  audit: ReturnType<typeof createAuditRepository>,
  shared: Pick<DashboardsDependencies, 'lookup' | 'openSource' | 'executor' | 'repository'> & {
    readonly notifications: Notifications;
    readonly dashboards: Dashboards;
  },
): Pick<Services, 'alerts' | 'alertSettings' | 'alertEvaluation' | 'panelLinks'> {
  const { database } = dependencies;
  const { notifications, openSource, executor } = shared;
  const states = createAlertStateRepository(database);
  const alertSettings = createAlertSettings({ store: dependencies.settings, audit });
  const origin = dependencies.publicUrl?.replace(/\/$/, '') ?? '';
  const alertEvaluation = {
    openSource,
    executor,
    states,
    notify: (channelIds: readonly string[], notification: Notification) =>
      notifications.send(channelIds, notification),
    alertUrl: (alertId: string) => `${origin}/alerts/${encodeURIComponent(alertId)}`,
    notifyOnError: () => alertSettings.get().notifyOnError,
  };
  const channelExists = (id: string) => notifications.picker().some((each) => each.id === id);
  const repository = createAlertRepository(database);
  const activity = createAlertActivityRepository(database);
  const links = createAlertLinkRepository(database);
  const base = { ...shared, ...alertEvaluation, audit, repository, channelExists, activity, links };
  const alerts = createAlerts({ ...base, settings: alertSettings });
  const pinned = () => shared.repository.listPinned();
  const panelLinks = createPanelLinks({ ...shared, links, repository, states, audit, pinned });
  return { alerts, alertSettings, alertEvaluation, panelLinks };
}

/**
 * The services that keep what the answering service writes: questions, their bin, and
 * explanations.
 *
 * @param database - The database.
 * @param dashboardDependencies - What the dashboards' services share.
 * @param modelView - The connectors as the model sees them, for their access levels.
 * @returns The questions, the bin of conversations and the explanations.
 */
function answerServices(
  database: ServiceDependencies['database'],
  dashboardDependencies: DashboardsDependencies,
  modelView: ModelView,
): Pick<Services, 'questions' | 'explanations'> & { readonly conversationBin: ConversationBin } {
  const stored = {
    questions: createQuestionRepository(database),
    binnedConversations: createConversationBinRepository(database),
  };
  const questions = createQuestions({
    ...dashboardDependencies,
    ...stored,
    connectorLevels: () => modelView.connectors(),
  });
  const conversationBin = createConversationBin({ ...dashboardDependencies, ...stored });
  const explanations = createExplanations({
    ...dashboardDependencies,
    explanations: createExplanationRepository(database),
  });
  return { questions, conversationBin, explanations };
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
 * Seals again every secret not sealed with the current key: connector credentials, model API
 * keys, users, sign-in providers and notification channels. Run at startup, so a rotated-out key can be dropped after one restart.
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
  const channels = await resealChannels(createChannelRepository(database), secretBox);
  const models = await resealModelKeys({ store: settings, secretBox });
  return connectors + users + linked + clients + channels + models;
}

/**
 * What the configuration file manages.
 *
 * @param dependencies - The database and the email index.
 * @returns The view of it.
 */
function provisioningParts(dependencies: ServiceDependencies): Pick<Services, 'managed'> {
  const repository = createProvisionedRepository(dependencies.database);
  return { managed: createManaged(repository, dependencies.emailIndex) };
}

/**
 * The settings sections' services.
 *
 * @param dependencies - The settings store and the secret box.
 * @param audit - The audit log.
 * @param usage - The usage ledger, for the model settings' monthly view.
 * @returns The services.
 */
function settingsServices(
  dependencies: ServiceDependencies,
  audit: ReturnType<typeof createAuditRepository>,
  usage: Usage,
): Pick<Services, 'modelSettings' | 'querySettings' | 'chartSettings' | 'retention'> {
  const store = dependencies.settings;
  return {
    modelSettings: createModelSettings({
      store,
      secretBox: dependencies.secretBox,
      audit,
      usage: () => usage.month(),
    }),
    querySettings: createQuerySettings({ store, audit }),
    chartSettings: createChartSettings({ store, audit }),
    retention: createRetentionSettings({ store, audit }),
  };
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
  const settings = settingsServices(dependencies, audit, usage);
  const threads = createThreads({ repository, audit });
  const accounts = createAccounts(dependencies, audit);
  const bin = createThreadBin({
    repository: createThreadBinRepository(dependencies.database),
    audit,
  });
  const channels = () => data.notifications.picker();
  const agent = createAgent({ ...data, threads, usage, ...settings, channels });
  const writer = createMetadataWriter({ modelSettings: settings.modelSettings, usage });
  const describeForPin = pinDescriber(writer, threads, bin);
  return {
    ...data,
    threads,
    ...accounts,
    bin,
    describeForPin,
    agent,
    answers: createAnswers({ ...data, usage, modelSettings: settings.modelSettings }),
    usage,
    ...settings,
    ...provisioningParts(dependencies),
  };
}

/**
 * The notification channels, and sending to them.
 *
 * @param dependencies - The database, the secret box and the public URL.
 * @param audit - The audit log.
 * @returns The service.
 */
function notificationService(
  dependencies: ServiceDependencies,
  audit: ReturnType<typeof createAuditRepository>,
): Notifications {
  return createNotifications({
    repository: createChannelRepository(dependencies.database),
    secretBox: dependencies.secretBox,
    audit,
    publicUrl: dependencies.publicUrl,
    alertsUsing: createAlertChannelUsage(dependencies.database),
    reportsUsing: createReportChannelUsage(dependencies.database),
  });
}
