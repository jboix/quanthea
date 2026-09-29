/** Bootstrap: configuration, database and migrations, then the HTTP server. */
// The release version lives in the root package.json, which semantic-release bumps.
import rootPackage from '../../../package.json' with { type: 'json' };
import { routeModelWarnings } from './agent/warnings.ts';
import { createApp } from './app.ts';
import { resolveAuthMode } from './auth/auth-mode.ts';
import { createAuthenticator } from './auth/authenticator.ts';
import { accountsProblems } from './auth/readiness.ts';
import { loadConfig } from './config/config.ts';
import { connectorKinds } from './connectors/registry.ts';
import { openDatabase } from './db/database.ts';
import { runMigrations } from './db/migrate.ts';
import { createSettingsRepository } from './db/settings-repository.ts';
import { startPurgeJob } from './jobs/purge.ts';
import { createLogger } from './lib/logger.ts';
import { loadKeys } from './secrets/keys.ts';
import { createServices, resealSecrets } from './services.ts';
import { createSettingsStore } from './settings/settings-store.ts';

const config = loadConfig(process.env);
const logger = createLogger(config.logLevel, undefined, config.logFormat);
routeModelWarnings(logger);

const database = openDatabase(config.dataDir);
const appliedMigrations = runMigrations(database);
if (appliedMigrations.length > 0) logger.info('applied migrations', { appliedMigrations });

const settings = createSettingsStore(createSettingsRepository(database));
const authMode = resolveAuthMode(config.authModeOverride, settings, logger);
const keys = await loadKeys({ keys: config.keys, dataDir: config.dataDir, logger });
const missing = authMode === 'accounts' ? accountsProblems(config, keys) : [];
if (missing.length > 0) {
  throw new Error(`Accounts mode cannot start:\n- ${missing.join('\n- ')}`);
}
const dependencies = {
  database,
  kinds: connectorKinds,
  secretBox: keys.secretBox,
  settings,
  emailIndex: keys.emailIndex,
  sessionHashes: keys.sessionHashes,
  peppers: keys.peppers,
};
const resealed = await resealSecrets(dependencies);
if (resealed > 0) logger.info('sealed secrets again with the current key', { resealed });
const services = createServices(dependencies);

const { sessions, users } = services;
const authenticator = createAuthenticator(authMode, sessions && { sessions, users });
if (authenticator.mode === 'none') {
  logger.warn('Open access: anyone who can reach this URL is an admin.');
}

const app = createApp({
  version: rootPackage.version,
  authenticator,
  logger,
  webDir: config.webDir,
  publicUrl: config.publicUrl,
  trustedProxyHops: config.trustedProxyHops,
  ...services,
});
const stopPurgeJob = startPurgeJob({ ...services, logger });

// A model call or a chat stream can go quiet for longer than Bun's default of 10 seconds.
const server = Bun.serve({ port: config.port, fetch: app.fetch, idleTimeout: 255 });
logger.info('listening', { url: server.url.href, dataDir: config.dataDir, webDir: config.webDir });

/**
 * Stops accepting requests, lets in-flight ones finish, closes the database, then exits.
 *
 * @param signal - The signal that asked for the shutdown.
 */
async function shutdown(signal: string): Promise<void> {
  logger.info('shutting down', { signal });
  stopPurgeJob();
  await server.stop();
  await services.connections.closeAll();
  database.close();
  process.exit(0);
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
