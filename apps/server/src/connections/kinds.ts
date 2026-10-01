/**
 * The connector kinds as the connections service sees them: their form for the add form, where a
 * connector of a kind points, and the kind of a stored connector, which may be gone when the
 * plugin that added it was removed.
 */
import type { ConnectorKindInfo } from '@quanthea/shared';
import { z } from 'zod';
import type { AnyConnectorKind, RegisteredKind } from '../connectors/_shared/index.ts';
import type { ConnectorRow } from '../db/connector-repository.ts';
import { AppError } from '../lib/errors.ts';

/**
 * Describes a kind for the add form, with the JSON Schemas of its config and secret.
 *
 * @param kind - The connector kind.
 * @returns The kind information.
 */
export function kindInfo(kind: RegisteredKind): ConnectorKindInfo {
  const formSchema = (schema: z.ZodType): Record<string, unknown> =>
    z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  return {
    kind: kind.kind,
    displayName: kind.displayName,
    icon: kind.icon ?? null,
    aliases: [...(kind.aliases ?? [])],
    language: kind.language,
    configSchema: formSchema(kind.configSchema),
    secretSchema: formSchema(kind.secretSchema),
    plugin: kind.plugin ? { name: kind.plugin.name, version: kind.plugin.version } : null,
  };
}

/**
 * Where a connector points, as its kind describes it.
 *
 * @param kind - The connector's kind.
 * @param config - The stored, parsed configuration.
 * @returns One line, or `null` when the kind does not describe targets.
 */
export function targetOf(kind: AnyConnectorKind, config: unknown): string | null {
  return kind.describeTarget?.(config) ?? null;
}

/**
 * What to say about a connector whose kind is not offered.
 *
 * @param kind - The kind identifier.
 * @returns The sentence.
 */
export function notInstalled(kind: string): string {
  return `The plugin that adds the kind "${kind}" is not installed. Install it, or delete this connector.`;
}

/**
 * Whether a stored connector's kind is offered.
 *
 * @param kinds - The kinds offered.
 * @param row - The stored connector.
 * @returns `false` when the plugin that added its kind is gone.
 */
export function installed(kinds: readonly RegisteredKind[], row: ConnectorRow): boolean {
  return kinds.some((candidate) => candidate.kind === row.kind);
}

/**
 * The kind of a stored connector.
 *
 * @param kinds - The kinds offered.
 * @param row - The stored connector.
 * @returns The kind.
 * @throws {AppError} `source_failed` when the plugin that added its kind is gone.
 */
export function storedKindOf(kinds: readonly RegisteredKind[], row: ConnectorRow): RegisteredKind {
  const found = kinds.find((candidate) => candidate.kind === row.kind);
  if (!found) throw new AppError('source_failed', notInstalled(row.kind));
  return found;
}

/**
 * Finds a kind for a new connector.
 *
 * @param kinds - The kinds offered.
 * @param kind - The kind identifier.
 * @returns The kind.
 * @throws {AppError} `bad_request` for an unknown kind.
 */
export function kindOf(kinds: readonly RegisteredKind[], kind: string): AnyConnectorKind {
  const found = kinds.find((candidate) => candidate.kind === kind);
  if (!found) throw new AppError('bad_request', `Unknown connector kind "${kind}".`);
  return found;
}
