/**
 * Connectors in the configuration file, keyed by name:
 *
 * ```yaml
 * connectors:
 *   shop:
 *     kind: postgres
 *     config: { host: db, database: shop, username: querent_ro }
 *     secret: { password: ${SHOP_PASSWORD} }
 * ```
 *
 * Every field but the name is the API's. A connector's kind never changes. When the file leaves
 * out `descriptions`, admins keep editing them in the interface.
 */
import { connectorInputSchema, connectorNameSchema } from '@querent/shared';
import type { z } from 'zod';
import type { ConfigFile } from '../config/config-file.ts';
import type { Connections } from '../connections/connections.ts';
import { AppError } from '../lib/errors.ts';
import type { Logger } from '../lib/logger.ts';
import { type Applier, type Planned, provisioningActor } from './reconcile.ts';
import { secretValues } from './secret-references.ts';

/** A connector as the file declares it, without its name and secret. */
const declaredSchema = connectorInputSchema.omit({ name: true, secret: true }).strict();

/** A connector ready to apply. */
type DesiredConnector = Omit<z.output<typeof connectorInputSchema>, 'name' | 'descriptions'> & {
  /** The descriptions, when the file declares them. */
  readonly descriptions?: Record<string, string>;
};

/** How long reading a provisioned connector's schema may take. */
const schemaTimeoutMs = 30_000;

/**
 * One connector as declared, checked.
 *
 * @param file - The configuration file.
 * @param name - The connector's name.
 * @param issues - Collects what is wrong.
 * @returns The connector, or `undefined` when it is invalid.
 */
function planOne(
  file: ConfigFile,
  name: string,
  issues: string[],
): Planned<DesiredConnector> | undefined {
  const where = `connectors.${name}`;
  const path = file.origins[where] ?? '';
  const written = (file.raw.connectors?.[name] ?? {}) as Record<string, unknown>;
  const declared = { ...(file.sections.connectors?.[name] as object) } as Record<string, unknown>;
  const secret = secretValues(written.secret, declared.secret, `${where}.secret`, issues);
  delete declared.secret;
  const named = connectorNameSchema.safeParse(name);
  const parsed = declaredSchema.safeParse(declared);
  if (!named.success) issues.push(`${where}: ${named.error.issues[0]?.message}`);
  if (!parsed.success)
    issues.push(
      ...parsed.error.issues.map((issue) => `${where}.${issue.path.join('.')}: ${issue.message}`),
    );
  if (!(named.success && parsed.success)) return undefined;
  const keepsDescriptions = 'descriptions' in written;
  const { descriptions, ...rest } = parsed.data;
  const desired = { ...rest, secret, ...(keepsDescriptions ? { descriptions } : {}) };
  return { name, path, desired, editable: keepsDescriptions ? [] : ['descriptions'] };
}

/**
 * The connectors the file declares, checked.
 *
 * @param file - The configuration file.
 * @param issues - Collects what is wrong.
 * @returns The connectors.
 */
export function planConnectors(file: ConfigFile, issues: string[]): Planned<DesiredConnector>[] {
  return Object.keys(file.sections.connectors ?? {}).flatMap((name) => {
    const planned = planOne(file, name, issues);
    return planned ? [planned] : [];
  });
}

/**
 * Reads a provisioned connector's schema in the background, so it is ready for the first thread.
 *
 * @param connections - The connections.
 * @param id - The connector's id.
 * @param name - Its name.
 * @param logger - Receives the outcome.
 */
function readSchemaLater(connections: Connections, id: string, name: string, logger: Logger): void {
  connections.refreshSchema(id, AbortSignal.timeout(schemaTimeoutMs)).then(
    () => logger.info('read the schema of a provisioned connector', { name }),
    (error: unknown) =>
      logger.warn('could not read the schema of a provisioned connector', {
        name,
        error: error instanceof Error ? error.message : String(error),
      }),
  );
}

/**
 * Creates or updates one connector.
 *
 * @param connections - The connections.
 * @param item - The connector as declared.
 * @returns Its id.
 * @throws {AppError} `bad_request` when its kind would change, or its settings are invalid.
 */
async function applyConnector(
  connections: Connections,
  item: Planned<DesiredConnector>,
): Promise<string> {
  const existing = connections.list().find((each) => each.name === item.name);
  const { kind, descriptions, ...patch } = item.desired;
  if (!existing) {
    const input = { name: item.name, kind, ...patch, descriptions: descriptions ?? {} };
    return (await connections.create(input, provisioningActor)).id;
  }
  if (existing.kind !== kind)
    throw new AppError(
      'bad_request',
      `It is a ${existing.kind} connector; a kind never changes. Give the ${kind} one another name.`,
    );
  const change = { ...patch, ...(descriptions ? { descriptions } : {}) };
  await connections.update(existing.id, change, provisioningActor);
  return existing.id;
}

/**
 * How connectors are applied.
 *
 * @param connections - The connections.
 * @param logger - Receives what happened.
 * @returns The applier.
 */
export function connectorApplier(
  connections: Connections,
  logger: Logger,
): Applier<DesiredConnector> {
  const idOf = (name: string) => connections.list().find((each) => each.name === name)?.id;
  return {
    kind: 'connector',
    exists: (name) => idOf(name) !== undefined,
    apply: async (item) => {
      const id = await applyConnector(connections, item);
      readSchemaLater(connections, id, item.name, logger);
    },
    remove: async (name) => {
      const id = idOf(name);
      if (id) await connections.remove(id, provisioningActor);
    },
  };
}
