/** Validates a connector's configuration and credentials against its kind's schemas. */
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
