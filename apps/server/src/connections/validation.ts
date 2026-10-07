/**
 * Validates a connector's configuration and credentials against its kind's schemas, and keeps
 * credentials out of the configuration's URLs.
 */
import type { z } from 'zod';
import type { AnyConnectorKind } from '../connectors/_shared/index.ts';
import { AppError } from '../lib/errors.ts';

/** A validation problem, sent in `error.details`. */
interface SettingIssue {
  /** `config` or `secret`. */
  readonly part: 'config' | 'secret';
  /** The dotted path of the field. */
  readonly path: string;
  /** What is wrong. */
  readonly message: string;
}

/**
 * Names a missing value plainly, instead of Zod's "expected string, received undefined".
 *
 * @param issue - The issue Zod is about to report.
 * @param issue.code - Its code.
 * @param issue.input - The value it is about.
 * @returns `Required.` for a missing value, else `undefined` for Zod's own message.
 */
function missingIsRequired(issue: { readonly code?: string; readonly input?: unknown }) {
  return issue.code === 'invalid_type' && issue.input === undefined ? 'Required.' : undefined;
}

/**
 * Parses one part with a kind's schema, collecting issues. Issues never quote the value, because a
 * secret may be in it.
 *
 * @param schema - The kind's schema for the part.
 * @param part - Which part.
 * @param value - The value.
 * @param issues - Receives the problems.
 * @returns The parsed value, or `undefined` when it is invalid.
 */
function parsePart(
  schema: z.ZodType,
  part: SettingIssue['part'],
  value: unknown,
  issues: SettingIssue[],
): unknown {
  const parsed = schema.safeParse(value, { error: missingIsRequired });
  if (parsed.success) return parsed.data;
  parsed.error.issues.forEach((issue) => {
    issues.push({ part, path: issue.path.map(String).join('.'), message: issue.message });
  });
  return undefined;
}

/**
 * Validates a configuration and credentials for a kind.
 *
 * @param kind - The connector kind.
 * @param config - The configuration.
 * @param secret - The credentials.
 * @returns Both, parsed: defaults filled in and unknown fields dropped.
 * @throws {AppError} `bad_request`, listing every problem without quoting values.
 */
export function validateSettings(
  kind: AnyConnectorKind,
  config: unknown,
  secret: unknown,
): { config: unknown; secret: unknown } {
  const issues: SettingIssue[] = [];
  const parsedConfig = parsePart(kind.configSchema, 'config', config, issues);
  const parsedSecret = parsePart(kind.secretSchema, 'secret', secret, issues);
  if (issues.length > 0)
    throw new AppError('bad_request', `The ${kind.displayName} settings are invalid.`, issues);
  return { config: parsedConfig, secret: parsedSecret };
}

/** Why a URL with credentials is refused. It never quotes the URL. */
export const urlCredentialsMessage =
  "A URL must not hold a username or password, because the configuration is stored in clear. Use the connector's authentication fields.";

/**
 * Whether a text is a URL with a username or a password.
 *
 * @param text - The text.
 * @returns Whether it is.
 */
function holdsCredentials(text: string): boolean {
  const url = URL.parse(text);
  return url !== null && (url.username !== '' || url.password !== '');
}

/**
 * The dotted paths of the URLs with a username or a password in a configuration, at any depth.
 *
 * @param value - The configuration, or a value inside it.
 * @param path - Where the value is.
 * @returns The paths, empty when no URL holds credentials.
 */
export function urlCredentialPaths(value: unknown, path: readonly string[] = []): string[] {
  if (typeof value === 'string') return holdsCredentials(value) ? [path.join('.')] : [];
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, inner]) => urlCredentialPaths(inner, [...path, key]));
}

/**
 * Validates the settings of a connector being created or changed: as `validateSettings` does,
 * and refusing a URL with a username or a password.
 *
 * @param kind - The connector kind.
 * @param config - The configuration.
 * @param secret - The credentials.
 * @returns Both, parsed.
 * @throws {AppError} `bad_request`, listing every problem without quoting values.
 */
export function validateNewSettings(
  kind: AnyConnectorKind,
  config: unknown,
  secret: unknown,
): { config: unknown; secret: unknown } {
  const settings = validateSettings(kind, config, secret);
  const issues: SettingIssue[] = urlCredentialPaths(settings.config).map((path) => ({
    part: 'config',
    path,
    message: urlCredentialsMessage,
  }));
  if (issues.length > 0)
    throw new AppError('bad_request', `The ${kind.displayName} settings are invalid.`, issues);
  return settings;
}
