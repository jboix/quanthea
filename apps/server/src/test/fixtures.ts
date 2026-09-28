/** Helpers shared by the server tests. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Principal } from '@querent/shared';
import type { Authenticator } from '../auth/authenticator.ts';
import { createLogger, type Logger } from '../lib/logger.ts';

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
