/** Boot-time configuration, read once from the environment. */
import { resolve } from 'node:path';
import { type AuthMode, authModeSchema } from '@querent/shared';
import { z } from 'zod';
import { type LogLevel, logLevels } from '../lib/logger.ts';

/** The server configuration. Everything else lives in the settings store. */
export interface Config {
  /** The HTTP port. */
  readonly port: number;
  /** Absolute path of the directory holding the SQLite database and generated keys. */
  readonly dataDir: string;
  /** When set, replaces the stored authentication mode. `none` is the lockout escape hatch. */
  readonly authModeOverride: AuthMode | undefined;
  /** The least severe log level written. */
  readonly logLevel: LogLevel;
  /** Absolute path of the built SPA the server serves. */
  readonly webDir: string;
}

/** Treats an empty variable as unset, so `QUERENT_AUTH_MODE=` means "no override". */
const unsetWhenEmpty = (value: unknown): unknown => (value === '' ? undefined : value);

/** Validates the environment variables the server reads. */
const environmentSchema = z.object({
  QUERENT_PORT: z.preprocess(
    unsetWhenEmpty,
    z.coerce.number().int().min(1).max(65535).default(3000),
  ),
  QUERENT_DATA_DIR: z.preprocess(unsetWhenEmpty, z.string().default('./data')),
  QUERENT_AUTH_MODE: z.preprocess(unsetWhenEmpty, authModeSchema.optional()),
  QUERENT_LOG_LEVEL: z.preprocess(unsetWhenEmpty, z.enum(logLevels).default('info')),
  QUERENT_WEB_DIR: z.preprocess(unsetWhenEmpty, z.string().optional()),
});

/** Where `bun run build` puts the SPA, relative to this file. */
const defaultWebDir = resolve(import.meta.dir, '../../../web/dist');

/**
 * Reads the configuration from environment variables.
 *
 * @param environment - The variables to read, usually `process.env`.
 * @param workingDir - The directory relative paths resolve against.
 * @returns The validated configuration, with every path made absolute.
 * @throws {Error} When a variable is set to an invalid value. The message lists every problem.
 */
export function loadConfig(
  environment: Readonly<Record<string, string | undefined>>,
  workingDir: string = process.cwd(),
): Config {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(parsed.error)}`);
  }
  const variables = parsed.data;
  return {
    port: variables.QUERENT_PORT,
    dataDir: resolve(workingDir, variables.QUERENT_DATA_DIR),
    authModeOverride: variables.QUERENT_AUTH_MODE,
    logLevel: variables.QUERENT_LOG_LEVEL,
    webDir: variables.QUERENT_WEB_DIR
      ? resolve(workingDir, variables.QUERENT_WEB_DIR)
      : defaultWebDir,
  };
}
