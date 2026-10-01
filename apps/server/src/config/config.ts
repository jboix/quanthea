/**
 * The system settings, read once at startup. Each comes from its environment variable, else the
 * configuration file (the `server` section, or the `plugins` section for the plugin settings),
 * else its default, and the source is kept so the interface can show it. Keys come from the
 * environment or the keys directory, never the file. Plugin pins come from the file only.
 */
import { join, resolve } from 'node:path';
import type { SettingSource } from '@quanthea/shared';
import { z } from 'zod';
import { type LogFormat, type LogLevel, logFormats, logLevels } from '../lib/logger.ts';
import type { KeyInput, KeyInputs } from '../secrets/keys.ts';
import { type ConfigFile, type ConfigSection, readConfigFile } from './config-file.ts';

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
const publicUrlSchema = z
  .url()
  .transform((value) => new URL(value))
  .refine(
    (url) => url.protocol === 'https:' || (url.protocol === 'http:' && isLoopback(url.hostname)),
    { message: 'Use https://, or http:// on localhost only.' },
  )
  .refine(
    (url) => url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password,
    { message: 'Give the origin only, such as https://quanthea.example.com.' },
  )
  .transform((url) => url.origin);

/** A directory path, resolved against the working directory. */
const pathSchema = z.string().min(1);

/** A yes or no, from the file or from a variable's text. */
const flagSchema = z.union([
  z.boolean(),
  z.enum(['true', 'false']).transform((value) => value === 'true'),
]);

/** A plugin's npm package name: `quanthea-plugin-<name>`, scoped or not. */
export const pluginNameSchema = z
  .string()
  .regex(
    /^(@[a-z0-9][a-z0-9._-]*\/)?quanthea-plugin-[a-z0-9][a-z0-9._-]*$/,
    'Name it quanthea-plugin-<name> or @scope/quanthea-plugin-<name>.',
  );

/** A plugin pin, as `quanthea plugin install` prints it. */
export const pinSchema = z
  .string()
  .regex(/^sha256:[0-9a-f]{64}$/, 'Paste the pin quanthea plugin install printed: sha256:….');

/** The pins of the file's `plugins` section, by package name. */
const pinsSchema = z.record(pluginNameSchema, pinSchema);

/**
 * The system settings: each one's variable, label, schema and default. The key is its name in the
 * file's `server` section.
 */
export const settingSpecs = {
  publicUrl: {
    variable: 'QUANTHEA_PUBLIC_URL',
    label: 'Public URL',
    schema: publicUrlSchema,
    fallback: undefined,
  },
  trustedProxyHops: {
    variable: 'QUANTHEA_TRUSTED_PROXY_HOPS',
    label: 'Trusted proxies',
    schema: z.coerce.number().int().min(0).max(5),
    fallback: 0,
  },
  port: {
    variable: 'QUANTHEA_PORT',
    label: 'HTTP port',
    schema: z.coerce.number().int().min(1).max(65535),
    fallback: 3000,
  },
  dataDir: {
    variable: 'QUANTHEA_DATA_DIR',
    label: 'Data directory',
    schema: pathSchema,
    fallback: './data',
  },
  keysDir: {
    variable: 'QUANTHEA_KEYS_DIR',
    label: 'Keys directory',
    schema: pathSchema,
    fallback: './keys',
  },
  webDir: {
    variable: 'QUANTHEA_WEB_DIR',
    label: 'Web app directory',
    schema: pathSchema,
    fallback: undefined,
  },
  logLevel: {
    variable: 'QUANTHEA_LOG_LEVEL',
    label: 'Log level',
    schema: z.enum(logLevels),
    fallback: 'info',
  },
  logFormat: {
    variable: 'QUANTHEA_LOG_FORMAT',
    label: 'Log format',
    schema: z.enum(logFormats),
    fallback: 'text',
  },
  pluginsDir: {
    variable: 'QUANTHEA_PLUGINS_DIR',
    label: 'Plugins directory',
    schema: pathSchema,
    fallback: undefined,
  },
  pluginsAllowUnpinned: {
    variable: 'QUANTHEA_PLUGINS_ALLOW_UNPINNED',
    label: 'Load unpinned plugins',
    schema: flagSchema,
    fallback: false,
  },
} as const;

/** Settings the file holds outside its `server` section: their section and key there. */
const fileKeys: Readonly<
  Partial<Record<keyof typeof settingSpecs, readonly [ConfigSection, string]>>
> = {
  pluginsDir: ['plugins', 'dir'],
  pluginsAllowUnpinned: ['plugins', 'allowUnpinned'],
};

/** The keys of the file's `plugins` section. */
const pluginKeys = new Set(['dir', 'allowUnpinned', 'pins']);

/** A system setting's name. */
export type SettingKey = keyof typeof settingSpecs;

/** The server configuration. Everything else lives in the settings store. */
export interface Config {
  /** The HTTP port. */
  readonly port: number;
  /** Absolute path of the directory holding the SQLite database. */
  readonly dataDir: string;
  /** Absolute path of the directory generated keys are kept in, outside the data directory. */
  readonly keysDir: string;
  /** The least severe log level written. */
  readonly logLevel: LogLevel;
  /** How log lines are written: readable text, or JSON for log collectors. */
  readonly logFormat: LogFormat;
  /** Absolute path of the built SPA the server serves. */
  readonly webDir: string;
  /** The keys, as given; `secrets/keys.ts` reads and checks them. */
  readonly keys: KeyInputs;
  /**
   * The address people reach quanthea at, such as `https://quanthea.example.com`: its origin only.
   * Redirect URIs and the CSRF check use it, never the request's Host header.
   */
  readonly publicUrl: string | undefined;
  /** How many reverse proxies in front of quanthea add to `X-Forwarded-For`; 0 trusts none. */
  readonly trustedProxyHops: number;
  /** The configuration files read, in order. */
  readonly configFiles: readonly string[];
  /** The configuration file's sections, for provisioning; `undefined` without a file. */
  readonly file: ConfigFile | undefined;
  /** Where each system setting comes from. */
  readonly sources: Readonly<Record<SettingKey, SettingSource>>;
  /** Absolute path of the directory plugins load from: `<data dir>/plugins` by default. */
  readonly pluginsDir: string;
  /** Whether a plugin without a pin loads. */
  readonly pluginsAllowUnpinned: boolean;
  /** The pin of each plugin, by package name, from the file's `plugins` section. */
  readonly pluginPins: Readonly<Record<string, string>>;
}

/** The environment variables. */
type Environment = Readonly<Record<string, string | undefined>>;

/**
 * A variable's value, treating an empty one as unset, so `QUANTHEA_LOG_LEVEL=` means "no override".
 *
 * @param environment - The environment variables.
 * @param name - The variable.
 * @returns Its value, or `undefined`.
 */
function variable(environment: Environment, name: string): string | undefined {
  const value = environment[name];
  return value === '' ? undefined : value;
}

/** The key variables, without the `QUANTHEA_` prefix, by the field they fill. */
const keyVariables = {
  secret: 'SECRET_KEY',
  secretPrevious: 'SECRET_KEY_PREVIOUS',
  session: 'SESSION_KEY',
  pepper: 'PASSWORD_PEPPER',
  pepperPrevious: 'PASSWORD_PEPPER_PREVIOUS',
} as const satisfies Record<keyof KeyInputs, string>;

/** Where the built SPA sits relative to this file, for `bun run start` from the repository. */
const defaultWebDir = resolve(import.meta.dir, '../../../web/dist');

/**
 * The key inputs from the environment.
 *
 * @param environment - The environment variables.
 * @param workingDir - Resolves relative key file paths.
 * @returns The inputs by field.
 */
function keyInputsOf(environment: Environment, workingDir: string): KeyInputs {
  const entries = Object.entries(keyVariables).map(([field, name]) => {
    const file = variable(environment, `QUANTHEA_${name}_FILE`);
    const input: KeyInput = {
      name: `QUANTHEA_${name}`,
      value: variable(environment, `QUANTHEA_${name}`),
      file: file === undefined ? undefined : resolve(workingDir, file),
    };
    return [field, input];
  });
  return Object.fromEntries(entries) as unknown as KeyInputs;
}

/** Where a raw value was found, for its source and for messages. */
interface Found {
  /** The value as given. */
  readonly raw: unknown;
  /** Where it comes from. */
  readonly source: SettingSource;
  /** Where it was set, in words. */
  readonly where: string;
}

/**
 * Finds a setting's raw value: the variable, else the file, else the default.
 *
 * @param key - The setting.
 * @param environment - The environment variables.
 * @param file - The configuration file, if any.
 * @returns The raw value and where it comes from.
 */
function find(key: SettingKey, environment: Environment, file: ConfigFile | undefined): Found {
  const spec = settingSpecs[key];
  const fromVariable = variable(environment, spec.variable);
  if (fromVariable !== undefined)
    return {
      raw: fromVariable,
      source: { kind: 'environment', variable: spec.variable },
      where: spec.variable,
    };
  const [section, name] = fileKeys[key] ?? ['server', key];
  const fromFile = file?.sections[section]?.[name];
  const path = file?.origins[`${section}.${name}`];
  if (fromFile !== undefined && path !== undefined)
    return {
      raw: fromFile,
      source: { kind: 'file', path },
      where: `${section}.${name} in ${path}`,
    };
  return { raw: spec.fallback, source: { kind: 'default' }, where: 'default' };
}

/** The settings' values once parsed, by name. */
type SettingValues = {
  -readonly [Key in SettingKey]: z.output<(typeof settingSpecs)[Key]['schema']>;
};

/**
 * Parses every setting, collecting every issue.
 *
 * @param environment - The environment variables.
 * @param file - The configuration file, if any.
 * @returns The values and their sources, and the issues.
 */
function resolveSettings(environment: Environment, file: ConfigFile | undefined) {
  const values: Partial<SettingValues> = {};
  const sources = {} as Record<SettingKey, SettingSource>;
  const issues: string[] = [];
  for (const key of Object.keys(settingSpecs) as SettingKey[]) {
    const found = find(key, environment, file);
    sources[key] = found.source;
    if (found.raw === undefined) continue;
    const parsed = settingSpecs[key].schema.safeParse(found.raw);
    if (parsed.success) Object.assign(values, { [key]: parsed.data });
    else
      issues.push(`${found.where}: ${parsed.error.issues.map((issue) => issue.message).join(' ')}`);
  }
  return { values, sources, issues };
}

/**
 * The names in the file's `server` section that are not settings.
 *
 * @param file - The configuration file, if any.
 * @returns One issue per unknown name.
 */
function unknownSettings(file: ConfigFile | undefined): string[] {
  const unknown = (section: 'server' | 'plugins', known: (key: string) => boolean) =>
    Object.keys(file?.sections[section] ?? {})
      .filter((key) => !known(key))
      .map((key) => `${section}.${key} in ${file?.origins[`${section}.${key}`]} is not a setting.`);
  return [
    ...unknown('server', (key) => Object.hasOwn(settingSpecs, key) && !fileKeys[key as SettingKey]),
    ...unknown('plugins', (key) => pluginKeys.has(key)),
  ];
}

/**
 * The plugin pins of the file's `plugins` section.
 *
 * @param file - The configuration file, if any.
 * @returns The pins, and the issues with them.
 */
function pinsOf(file: ConfigFile | undefined) {
  const raw = file?.sections.plugins?.pins;
  if (raw === undefined) return { pins: {}, issues: [] };
  const parsed = pinsSchema.safeParse(raw);
  if (parsed.success) return { pins: parsed.data, issues: [] };
  const where = file?.origins['plugins.pins'] ?? 'the file';
  return {
    pins: {},
    issues: parsed.error.issues.map((issue) => {
      const message =
        issue.code === 'invalid_key'
          ? 'not a plugin name: quanthea-plugin-<name> or @scope/quanthea-plugin-<name>.'
          : issue.message;
      return `plugins.pins.${issue.path.join('.')} in ${where}: ${message}`;
    }),
  };
}

/**
 * Reads and validates the configuration.
 *
 * @param environment - The process environment.
 * @param workingDir - Resolves relative paths.
 * @returns The configuration.
 * @throws {Error} Naming every invalid variable and setting.
 */
export function loadConfig(environment: Environment, workingDir: string = process.cwd()): Config {
  const configVariable = variable(environment, 'QUANTHEA_CONFIG');
  const configPath = configVariable ? resolve(workingDir, configVariable) : undefined;
  const file = configPath ? readConfigFile(configPath, environment) : undefined;
  const { values, sources, issues } = resolveSettings(environment, file);
  const pinned = pinsOf(file);
  const problems = [...unknownSettings(file), ...issues, ...pinned.issues];
  if (problems.length > 0) throw new Error(`Invalid configuration:\n- ${problems.join('\n- ')}`);
  const settings = values as SettingValues;
  const dataDir = resolve(workingDir, settings.dataDir);
  return {
    port: settings.port,
    dataDir,
    keysDir: resolve(workingDir, settings.keysDir),
    logLevel: settings.logLevel,
    logFormat: settings.logFormat,
    webDir: settings.webDir ? resolve(workingDir, settings.webDir) : defaultWebDir,
    keys: keyInputsOf(environment, workingDir),
    publicUrl: settings.publicUrl,
    trustedProxyHops: settings.trustedProxyHops,
    configFiles: file?.paths ?? [],
    file,
    sources,
    ...pluginSettings(settings, dataDir, workingDir),
    pluginPins: pinned.pins,
  };
}

/**
 * Where plugins load from, and whether unpinned ones do.
 *
 * @param settings - The parsed settings.
 * @param dataDir - The data directory, which holds `plugins` by default.
 * @param workingDir - Resolves a relative path.
 * @returns The plugin settings.
 */
function pluginSettings(settings: SettingValues, dataDir: string, workingDir: string) {
  return {
    pluginsDir: settings.pluginsDir
      ? resolve(workingDir, settings.pluginsDir)
      : join(dataDir, 'plugins'),
    pluginsAllowUnpinned: settings.pluginsAllowUnpinned,
  };
}
