/** Bootstrap: configuration, database and migrations, then the HTTP server. */
// The release version lives in the root package.json, which semantic-release bumps.
import rootPackage from '../../../package.json' with { type: 'json' };
import { routeModelWarnings } from './agent/warnings.ts';
import { createApp } from './app.ts';
import { createAuthenticator } from './auth/authenticator.ts';
import { ensureAdmin } from './auth/default-admin.ts';
import { loadConfig } from './config/config.ts';
import { serverSettingsView } from './config/server-view.ts';
import { connectorKinds } from './connectors/registry.ts';
import { openDatabase } from './db/database.ts';
import { runMigrations } from './db/migrate.ts';
import { createSettingsRepository } from './db/settings-repository.ts';
import { startAlertEvaluator } from './jobs/alert-evaluator.ts';
import { startPurgeJob } from './jobs/purge.ts';
import { startReportScheduler } from './jobs/report-scheduler.ts';
import { createLogger } from './lib/logger.ts';
import { loadPlugins, missingPinned } from './plugins/load.ts';
import { startProvisioning } from './provisioning/start.ts';
import { loadKeys } from './secrets/keys.ts';
import { createServices, resealSecrets } from './services.ts';
import { createSettingsStore } from './settings/settings-store.ts';

const config = loadConfig(process.env);
const logger = createLogger(config.logLevel, undefined, config.logFormat);
routeModelWarnings(logger);

const database = openDatabase(config.dataDir, logger);
const appliedMigrations = runMigrations(database);
if (appliedMigrations.length > 0) logger.info('applied migrations', { appliedMigrations });

const settings = createSettingsStore(createSettingsRepository(database));
const pluginKinds = await loadPlugins({
  dir: config.pluginsDir,
  pins: config.pluginPins,
  allowUnpinned: config.pluginsAllowUnpinned,
  offered: connectorKinds,
  logger,
});
for (const name of missingPinned(config.pluginsDir, config.pluginPins))
  logger.warn('pinned plugin not installed', { plugin: name });
const { keys: keyInputs, dataDir, keysDir } = config;
const keys = await loadKeys({ keys: keyInputs, dataDir, keysDir, logger });
const dependencies = {
  database,
  kinds: [...connectorKinds, ...pluginKinds],
  secretBox: keys.secretBox,
  settings,
  emailIndex: keys.emailIndex,
  sessionHashes: keys.sessionHashes,
  peppers: keys.peppers,
  publicUrl: config.publicUrl,
};
const resealed = await resealSecrets(dependencies);
if (resealed > 0) logger.info('sealed secrets again with the current key', { resealed });
const services = createServices(dependencies);
await startProvisioning({
  file: config.file,
  database,
  keys,
  services,
  logger,
});
// Answers stored before runs recorded their access get a record at their connectors' access now.
const accessOf = (name: string) => services.modelView.accessOf(name);
const recordedAnswers = services.threads.recordLegacyAccess(accessOf);
if (recordedAnswers > 0) logger.info('recorded the access of earlier answers', { recordedAnswers });

const { sessions, users, adminSetup } = services;
if (!sessions || !adminSetup)
  throw new Error('The session key and the password pepper are missing.');
await ensureAdmin(adminSetup, logger);
const authenticator = createAuthenticator({ sessions, users });

const app = createApp({
  version: rootPackage.version,
  authenticator,
  logger,
  webDir: config.webDir,
  publicUrl: config.publicUrl,
  trustedProxyHops: config.trustedProxyHops,
  serverSettings: serverSettingsView(config, keys.origins),
  ...services,
});
const stopPurgeJob = startPurgeJob({ ...services, logger });
const stopAlertEvaluator = startAlertEvaluator({
  alerts: services.alerts,
  evaluation: services.alertEvaluation,
  logger,
});
const stopReportScheduler = startReportScheduler({ reports: services.reports, logger });

// A model call or a chat stream can go quiet for longer than Bun's default of 10 seconds.
// Without a host, Bun listens on every interface.
const server = Bun.serve({
  ...(config.host === undefined ? {} : { hostname: config.host }),
  port: config.port,
  fetch: app.fetch,
  idleTimeout: 255,
});
logger.info('listening', { url: server.url.href, dataDir: config.dataDir, webDir: config.webDir });

/**
 * Stops accepting requests, lets in-flight ones finish, closes the database, then exits.
 *
 * @param signal - The signal that asked for the shutdown.
 */
async function shutdown(signal: string): Promise<void> {
  logger.info('shutting down', { signal });
  stopPurgeJob();
  stopAlertEvaluator();
  stopReportScheduler();
  await server.stop();
  await services.connections.closeAll();
  database.close();
  process.exit(0);
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
