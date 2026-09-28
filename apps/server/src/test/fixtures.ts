/** Helpers shared by the server tests. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Principal } from '@querent/shared';
import type { Authenticator } from '../auth/authenticator.ts';
import { type Connections, createConnections } from '../connections/connections.ts';
import type { AnyConnectorKind } from '../connectors/_shared/index.ts';
import { memoryConnector } from '../connectors/_shared/test/memory-connector.ts';
import { createAuditRepository } from '../db/audit-repository.ts';
import { createConnectorRepository } from '../db/connector-repository.ts';
import { openDatabase } from '../db/database.ts';
import { runMigrations } from '../db/migrate.ts';
import { createLogger, type Logger } from '../lib/logger.ts';
import { createSecretBox } from '../secrets/secret-box.ts';

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
  return { logger: createLogger('debug', { stdout: record, stderr: record }), lines };
}

/**
 * Creates an authenticator that returns a fixed principal.
 *
 * @param principal - The principal of every request, or `null` for "no session".
 * @returns The authenticator, reporting mode `basic` when the principal is not the anonymous admin.
 */
export function fixedAuthenticator(principal: Principal | null): Authenticator {
  return {
    mode: principal?.id === 'anonymous' ? 'none' : 'basic',
    authenticate: () => Promise.resolve(principal),
  };
}

/**
 * Creates a temporary directory for one test.
 *
 * @returns The directory path and a function that deletes it.
 */
export function temporaryDir(): { readonly path: string; readonly remove: () => void } {
  const path = mkdtempSync(join(tmpdir(), 'querent-test-'));
  return { path, remove: () => rmSync(path, { recursive: true, force: true }) };
}

/**
 * Creates a connectors service over a migrated database in a directory, with a fresh key.
 *
 * @param dataDir - The directory for the database.
 * @param kinds - The connector kinds on offer; the in-memory test kind by default.
 * @returns The service, and a function that closes its connections and the database.
 */
export async function testConnections(
  dataDir: string,
  kinds: readonly AnyConnectorKind[] = [memoryConnector],
): Promise<{ readonly connections: Connections; readonly close: () => Promise<void> }> {
  const database = openDatabase(dataDir);
  runMigrations(database);
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  const connections = createConnections({
    kinds,
    repository: createConnectorRepository(database),
    audit: createAuditRepository(database),
    secretBox: createSecretBox(key),
  });
  const close = async (): Promise<void> => {
    await connections.closeAll();
    database.close();
  };
  return { connections, close };
}
