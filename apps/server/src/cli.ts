/**
 * Commands for whoever runs the server, such as `querent reset-admin` inside the container. They
 * read the same configuration and keys as the server, so they run where it runs.
 *
 * `reset-admin [email]` prints a one-time link that sets an admin's password: the admin with that
 * email, or the first enabled admin. A disabled admin is enabled again. Without any admin, it
 * creates the default one and prints its password.
 */
import { ensureAdmin } from './auth/default-admin.ts';
import { changeUser } from './auth/user-admin.ts';
import { loadConfig } from './config/config.ts';
import { connectorKinds } from './connectors/registry.ts';
import { openDatabase } from './db/database.ts';
import { runMigrations } from './db/migrate.ts';
import { createSettingsRepository } from './db/settings-repository.ts';
import { createLogger } from './lib/logger.ts';
import { loadKeys } from './secrets/keys.ts';
import { createServices, type Services } from './services.ts';
import { createSettingsStore } from './settings/settings-store.ts';

/** How to use the commands. */
const usage = 'Usage: querent reset-admin [email]\n';

/**
 * Writes a line to the terminal.
 *
 * @param text - The line.
 */
function say(text: string): void {
  process.stdout.write(`${text}\n`);
}

/**
 * The services over the server's database and keys.
 *
 * @returns The services, the public URL, and a function that closes the database.
 */
async function openServices() {
  const config = loadConfig(process.env);
  const logger = createLogger('warn', undefined, config.logFormat);
  const database = openDatabase(config.dataDir);
  runMigrations(database);
  const settings = createSettingsStore(createSettingsRepository(database));
  const keys = await loadKeys({ ...config, logger });
  const services = createServices({ database, kinds: connectorKinds, settings, ...keys });
  return { services, logger, publicUrl: config.publicUrl, close: () => database.close() };
}

/**
 * The admin to reset: the one with the email given, or the first enabled one.
 *
 * @param services - The services.
 * @param email - The email given, if any.
 * @returns The admin's id, or `undefined`.
 */
async function adminToReset(services: Services, email: string | undefined) {
  if (email) {
    const row = await services.users.findByEmail(email);
    return row?.role === 'admin' ? row.id : undefined;
  }
  return services.userRows.list().find((row) => row.role === 'admin' && row.disabledAt === null)
    ?.id;
}

/**
 * Prints a one-time link that sets an admin's password.
 *
 * @param email - The admin's email, if given.
 * @returns The exit code.
 */
async function resetAdmin(email: string | undefined): Promise<number> {
  const { services, logger, publicUrl, close } = await openServices();
  try {
    if (!services.adminSetup || !services.passwords)
      throw new Error('Passwords are not available.');
    const id = await adminToReset(services, email);
    if (!id && email) {
      say(`No admin has the email ${email}.`);
      return 1;
    }
    if (!id) {
      await ensureAdmin(services.adminSetup, logger);
      return 0;
    }
    changeUser(services.userAdmin, id, { disabled: false }, 'querent-cli');
    const { token } = await services.passwords.issueLink(id, 'reset', 'querent-cli');
    say('Open this link to set the admin password. It works once, for 24 hours:');
    say(`${publicUrl ?? '<querent’s address>'}/set-password#${token}`);
    return 0;
  } finally {
    close();
  }
}

const [command, argument] = process.argv.slice(2);
if (command !== 'reset-admin') {
  process.stderr.write(usage);
  process.exit(2);
}
process.exit(await resetAdmin(argument));
