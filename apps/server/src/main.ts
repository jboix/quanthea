/** Bootstrap: configuration, database and migrations, then the HTTP server. */
// The release version lives in the root package.json, which semantic-release bumps.
import rootPackage from '../../../package.json' with { type: 'json' };
import { createApp } from './app.ts';
import { resolveAuthMode } from './auth/auth-mode.ts';
import { createAuthenticator } from './auth/authenticator.ts';
import { loadConfig } from './config/config.ts';
import { connectorKinds } from './connectors/registry.ts';
import { openDatabase } from './db/database.ts';
import { runMigrations } from './db/migrate.ts';
import { createSettingsRepository } from './db/settings-repository.ts';
import { createLogger } from './lib/logger.ts';
import { createSecretBox } from './secrets/secret-box.ts';
import { loadSecretKey } from './secrets/secret-key.ts';
import { createServices } from './services.ts';
import { createSettingsStore } from './settings/settings-store.ts';

const config = loadConfig(process.env);
const logger = createLogger(config.logLevel);

const database = openDatabase(config.dataDir);
const appliedMigrations = runMigrations(database);
if (appliedMigrations.length > 0) logger.info('applied migrations', { appliedMigrations });

const settings = createSettingsStore(createSettingsRepository(database));
const authenticator = createAuthenticator(
  resolveAuthMode(config.authModeOverride, settings, logger),
);
if (authenticator.mode === 'none') {
  logger.warn('Open access: anyone who can reach this URL is an admin.');
}

const secretKey = await loadSecretKey({
  configuredKey: config.secretKey,
  dataDir: config.dataDir,
  logger,
});
const { connections, dashboards } = createServices({
  database,
  kinds: connectorKinds,
  secretBox: createSecretBox(secretKey),
});

const app = createApp({
  version: rootPackage.version,
  authenticator,
  logger,
  webDir: config.webDir,
  connections,
  dashboards,
});
const server = Bun.serve({ port: config.port, fetch: app.fetch });
logger.info('listening', { url: server.url.href, dataDir: config.dataDir, webDir: config.webDir });

/**
 * Stops accepting requests, lets in-flight ones finish, closes the database, then exits.
 *
 * @param signal - The signal that asked for the shutdown.
 */
async function shutdown(signal: string): Promise<void> {
  logger.info('shutting down', { signal });
  await server.stop();
  await connections.closeAll();
  database.close();
  process.exit(0);
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
