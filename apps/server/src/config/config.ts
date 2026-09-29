/** Boot-time configuration, read once from the environment. */
import { resolve } from 'node:path';
import { type AuthMode, authModeSchema } from '@querent/shared';
import { z } from 'zod';
import { type LogFormat, type LogLevel, logFormats, logLevels } from '../lib/logger.ts';
import type { KeyInput, KeyInputs } from '../secrets/keys.ts';

/** The server configuration. Everything else lives in the settings store. */
export interface Config {
  /** The HTTP port. */
  readonly port: number;
  /** Absolute path of the directory holding the SQLite database. */
  readonly dataDir: string;
  /** Absolute path of the directory generated keys are kept in, outside the data directory. */
  readonly keysDir: string;
  /** When set, replaces the stored authentication mode. `none` is the lockout escape hatch. */
  readonly authModeOverride: AuthMode | undefined;
  /** The least severe log level written. */
  readonly logLevel: LogLevel;
  /** How log lines are written: readable text, or JSON for log collectors. */
  readonly logFormat: LogFormat;
  /** Absolute path of the built SPA the server serves. */
  readonly webDir: string;
  /** The keys, as given; `secrets/keys.ts` reads and checks them. */
  readonly keys: KeyInputs;
  /**
   * The address people reach querent at, such as `https://querent.example.com`: its origin only.
   * Redirect URIs and the CSRF check use it, never the request's Host header.
   */
  readonly publicUrl: string | undefined;
  /** How many reverse proxies in front of querent add to `X-Forwarded-For`; 0 trusts none. */
  readonly trustedProxyHops: number;
}

/** Treats an empty variable as unset, so `QUERENT_AUTH_MODE=` means "no override". */
const unsetWhenEmpty = (value: unknown): unknown => (value === '' ? undefined : value);

/** An optional text variable. */
const optionalText = z.preprocess(unsetWhenEmpty, z.string().optional());

/** The key variables, without the `QUERENT_` prefix, by the field they fill. */
const keyVariables = {
  secret: 'SECRET_KEY',
  secretPrevious: 'SECRET_KEY_PREVIOUS',
  session: 'SESSION_KEY',
  pepper: 'PASSWORD_PEPPER',
  pepperPrevious: 'PASSWORD_PEPPER_PREVIOUS',
} as const satisfies Record<keyof KeyInputs, string>;

/**
 * Whether a host is this machine, where plain HTTP is allowed.
 *
 * @param hostname - The host.
 * @returns Whether it is a loopback name or address.
 */
function isLoopback(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
}

/** Validates the public URL: HTTPS, or HTTP on this machine, with no path, query or credentials. */
const publicUrlSchema = z.preprocess(
  unsetWhenEmpty,
  z
    .url()
    .transform((value) => new URL(value))
    .refine(
      (url) => url.protocol === 'https:' || (url.protocol === 'http:' && isLoopback(url.hostname)),
      {
        message: 'Use https://, or http:// on localhost only.',
      },
    )
    .refine(
      (url) => url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password,
      {
        message: 'Give the origin only, such as https://querent.example.com.',
      },
    )
    .transform((url) => url.origin)
    .optional(),
);

/** Validates the environment variables the server reads. */
const environmentSchema = z.object({
  QUERENT_PORT: z.preprocess(
    unsetWhenEmpty,
    z.coerce.number().int().min(1).max(65535).default(3000),
  ),
  QUERENT_DATA_DIR: z.preprocess(unsetWhenEmpty, z.string().default('./data')),
  QUERENT_KEYS_DIR: z.preprocess(unsetWhenEmpty, z.string().default('./keys')),
  QUERENT_AUTH_MODE: z.preprocess(unsetWhenEmpty, authModeSchema.optional()),
  QUERENT_LOG_LEVEL: z.preprocess(unsetWhenEmpty, z.enum(logLevels).default('info')),
  QUERENT_LOG_FORMAT: z.preprocess(unsetWhenEmpty, z.enum(logFormats).default('text')),
  QUERENT_WEB_DIR: optionalText,
  QUERENT_PUBLIC_URL: publicUrlSchema,
  QUERENT_TRUSTED_PROXY_HOPS: z.preprocess(
    unsetWhenEmpty,
    z.coerce.number().int().min(0).max(5).default(0),
  ),
  ...Object.fromEntries(
    Object.values(keyVariables).flatMap((name) => [
      [`QUERENT_${name}`, optionalText],
      [`QUERENT_${name}_FILE`, optionalText],
    ]),
  ),
});

/** Where the built SPA sits relative to this file, for `bun run start` from the repository. */
const defaultWebDir = resolve(import.meta.dir, '../../../web/dist');

/**
 * The key inputs from the environment.
 *
 * @param environment - The validated variables.
 * @param workingDir - Resolves relative key file paths.
 * @returns The inputs by field.
 */
function keyInputsOf(environment: Record<string, unknown>, workingDir: string): KeyInputs {
  const entries = Object.entries(keyVariables).map(([field, name]) => {
    const file = environment[`QUERENT_${name}_FILE`] as string | undefined;
    const input: KeyInput = {
      name: `QUERENT_${name}`,
      value: environment[`QUERENT_${name}`] as string | undefined,
      file: file === undefined ? undefined : resolve(workingDir, file),
    };
    return [field, input];
  });
  return Object.fromEntries(entries) as unknown as KeyInputs;
}

/**
 * Reads and validates the configuration.
 *
 * @param environment - The process environment.
 * @param workingDir - Resolves relative paths.
 * @returns The configuration.
 * @throws {Error} Naming every invalid variable.
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
    keysDir: resolve(workingDir, variables.QUERENT_KEYS_DIR),
    authModeOverride: variables.QUERENT_AUTH_MODE,
    logLevel: variables.QUERENT_LOG_LEVEL,
    logFormat: variables.QUERENT_LOG_FORMAT,
    webDir: variables.QUERENT_WEB_DIR
      ? resolve(workingDir, variables.QUERENT_WEB_DIR)
      : defaultWebDir,
    keys: keyInputsOf(variables, workingDir),
    publicUrl: variables.QUERENT_PUBLIC_URL,
    trustedProxyHops: variables.QUERENT_TRUSTED_PROXY_HOPS,
  };
}
