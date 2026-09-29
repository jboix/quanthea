/**
 * Applies the configuration file again when it changes, without a restart. The files are read on
 * a short interval and compared by content, which holds for a bind-mounted file an editor replaces
 * and for a Kubernetes ConfigMap swapped behind a symbolic link, where file events do not. A change
 * that fails keeps the last good configuration and tells admins why. The `server` section is read
 * at startup only, so a change there waits for a restart.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { type ConfigFile, readConfigFile } from '../config/config-file.ts';
import type { Logger } from '../lib/logger.ts';
import type { ProvisioningStatus } from './status.ts';

/** How often the files are compared, in milliseconds. */
const defaultIntervalMs = 5_000;

/** What watching the file needs. */
export interface WatchDependencies {
  /** What `QUERENT_CONFIG` names: a file or a directory. */
  readonly path: string;
  /** The environment variables, for references. */
  readonly environment: Readonly<Record<string, string | undefined>>;
  /** The `server` section as read at startup. */
  readonly startupServer: Readonly<Record<string, unknown>>;
  /** Applies the file. */
  readonly apply: (file: ConfigFile) => Promise<void>;
  /** Tells admins what happened. */
  readonly status: ProvisioningStatus;
  /** Receives what happened. */
  readonly logger: Logger;
  /** How often to compare, in milliseconds. */
  readonly intervalMs?: number;
}

/**
 * The content of the configuration files, to tell a change.
 *
 * @param path - A file or a directory.
 * @returns Their names and content, joined; empty when the path is gone.
 */
export function configContent(path: string): string {
  try {
    if (!statSync(path).isDirectory()) return readFileSync(path, 'utf8');
    const names = readdirSync(path).filter((name) =>
      ['.yaml', '.yml', '.json'].includes(extname(name)),
    );
    return names
      .sort()
      .map((name) => `${name}\n${readFileSync(join(path, name), 'utf8')}`)
      .join('\n');
  } catch {
    return '';
  }
}

/**
 * The `server` settings that differ from startup.
 *
 * @param before - The section at startup.
 * @param after - The section now.
 * @returns Their names.
 */
function changedServerKeys(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys]
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .sort();
}

/**
 * Reads and applies the file once, recording the outcome.
 *
 * @param dependencies - The file, how to apply it and the status.
 * @returns Once it is done.
 */
export async function applyChange(dependencies: WatchDependencies): Promise<void> {
  const { status, logger } = dependencies;
  try {
    const file = readConfigFile(dependencies.path, dependencies.environment);
    await dependencies.apply(file);
    const restartNeeded = changedServerKeys(dependencies.startupServer, file.sections.server ?? {});
    status.setRestartNeeded(restartNeeded);
    status.setProblem(null);
    logger.info('applied the changed configuration file', { restartNeeded });
  } catch (error) {
    const problem = error instanceof Error ? error.message : String(error);
    status.setProblem(problem);
    logger.error('the changed configuration file was not applied', { problem });
  }
}

/**
 * Watches the configuration file and applies it when it changes.
 *
 * @param dependencies - The file, how to apply it and the status.
 * @returns A function that stops watching.
 */
export function watchConfig(dependencies: WatchDependencies): () => void {
  let seen = configContent(dependencies.path);
  let running = false;
  const check = async () => {
    const now = configContent(dependencies.path);
    if (running || now === seen) return;
    running = true;
    seen = now;
    await applyChange(dependencies).finally(() => {
      running = false;
    });
  };
  const timer = setInterval(() => void check(), dependencies.intervalMs ?? defaultIntervalMs);
  return () => clearInterval(timer);
}
