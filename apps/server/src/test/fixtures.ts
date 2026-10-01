/** Helpers shared by the server tests. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Principal, ServerSettingsView } from '@quanthea/shared';
import type { Authenticator } from '../auth/authenticator.ts';
import type { HashCosts } from '../auth/passwords.ts';
import type { AnyConnectorKind } from '../connectors/_shared/index.ts';
import { memoryConnector } from '../connectors/_shared/test/memory-connector.ts';
import { openDatabase } from '../db/database.ts';
import { runMigrations } from '../db/migrate.ts';
import { createSettingsRepository } from '../db/settings-repository.ts';
import { createLogger, type Logger } from '../lib/logger.ts';
import { type KeyedHash, keyedHash } from '../secrets/keyed-hash.ts';
import type { Peppers, SessionHashes } from '../secrets/keys.ts';
import { openSecretBox, type SecretBox } from '../secrets/secret-box.ts';
import { createServices, type ServiceDependencies, type Services } from '../services.ts';
import { createSettingsStore } from '../settings/settings-store.ts';

/** A logger that keeps its lines in memory. */
export interface CapturedLogger {
  /** The logger to hand to the code under test. */
  readonly logger: Logger;
  /** Every line written so far, parsed. */
  readonly lines: Record<string, unknown>[];
}

/**
 * Creates a logger that records every line instead of printing it.
 *
 * @returns The logger and its recorded lines.
 */
export function captureLogs(): CapturedLogger {
  const lines: Record<string, unknown>[] = [];
  const record = (line: string): void => {
    lines.push(JSON.parse(line));
  };
  return { logger: createLogger('debug', { stdout: record, stderr: record }, 'json'), lines };
}

/** An admin, as tests sign requests in. */
export const testAdmin: Principal = { id: 'admin-1', name: 'Admin', role: 'admin' };

/**
 * Creates an authenticator that returns a fixed principal.
 *
 * @param principal - The principal of every request, or `null` for "no session".
 * @returns The authenticator.
 */
export function fixedAuthenticator(principal: Principal | null): Authenticator {
  return { authenticate: () => Promise.resolve(principal) };
}

/**
 * A secret box over a fresh random key.
 *
 * @returns The box.
 */
export function testSecretBox(): Promise<SecretBox> {
  return openSecretBox(crypto.getRandomValues(new Uint8Array(32)));
}

/**
 * The email index, session hashes and peppers, over fresh random keys, and cheap hash costs.
 *
 * @returns The keyed hashes.
 */
export async function testKeyedHashes(): Promise<{
  emailIndex: KeyedHash;
  sessionHashes: SessionHashes;
  peppers: Peppers;
  passwordCosts: HashCosts;
}> {
  const key = () => crypto.getRandomValues(new Uint8Array(32));
  const pepper = await keyedHash(key(), 'quanthea/password-pepper/v1');
  return {
    peppers: { current: { id: 'pepper-1', hash: pepper }, previous: undefined },
    // Cheap argon2id costs keep tests fast; the server uses 64 MiB and 3 passes.
    passwordCosts: { memoryCost: 1024, timeCost: 1 },
    emailIndex: await keyedHash(key(), 'quanthea/email-index/v1'),
    sessionHashes: {
      signature: await keyedHash(key(), 'quanthea/session-signature/v1'),
      idHash: await keyedHash(key(), 'quanthea/session-id/v1'),
      tokenHash: await keyedHash(key(), 'quanthea/one-time-token/v1'),
    },
  };
}

/**
 * Creates a temporary directory for one test.
 *
 * @returns The directory path and a function that deletes it.
 */
export function temporaryDir(): { readonly path: string; readonly remove: () => void } {
  const path = mkdtempSync(join(tmpdir(), 'quanthea-test-'));
  return { path, remove: () => rmSync(path, { recursive: true, force: true }) };
}

/**
 * Opens a fresh database in a temporary directory and builds the services over it, wired as the
 * bootstrap wires them.
 *
 * @param dataDir - The temporary data directory.
 * @param kinds - The connector kinds on offer; the in-memory test kind by default.
 * @param now - The clock of the users and sessions; `Date.now` by default.
 * @param extra - A public URL and driver options, for provider sign-ins.
 * @returns The services, the database, an empty system settings view, the keyed hashes, and a
 *   function that closes the connections and the database.
 */
export async function testServices(
  dataDir: string,
  kinds: readonly AnyConnectorKind[] = [memoryConnector],
  now?: () => number,
  extra: Pick<ServiceDependencies, 'publicUrl' | 'driverOptions'> = {},
): Promise<
  Services & {
    readonly close: () => Promise<void>;
    readonly database: ReturnType<typeof openDatabase>;
    readonly serverSettings: ServerSettingsView;
    readonly hashes: Awaited<ReturnType<typeof testKeyedHashes>>;
  }
> {
  const database = openDatabase(dataDir);
  runMigrations(database);
  const settings = createSettingsStore(createSettingsRepository(database));
  const hashes = await testKeyedHashes();
  const services = createServices({
    database,
    kinds,
    secretBox: await testSecretBox(),
    settings,
    ...hashes,
    ...(now ? { now } : {}),
    ...extra,
  });
  const close = async (): Promise<void> => {
    await services.connections.closeAll();
    database.close();
  };
  const serverSettings = { configFiles: [], settings: [], keys: [] };
  return { ...services, close, database, serverSettings, hashes };
}
