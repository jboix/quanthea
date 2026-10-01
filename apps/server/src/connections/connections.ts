/**
 * Configured connectors: create, change, delete, test, and read their schema. Credentials are
 * sealed at rest, validated by their kind, and never returned. Open connections are kept until the
 * connector changes.
 */
import type {
  ConnectorDetail,
  ConnectorKindInfo,
  ConnectorSummary,
  connectorInputSchema,
  connectorPatchSchema,
  Guardrails,
  SchemaView,
} from '@querent/shared';
import { z } from 'zod';
import {
  type AnyConnectorKind,
  ConnectorError,
  type ConnectorInstance,
  type HealthReport,
  type SchemaSnapshot,
} from '../connectors/_shared/index.ts';
import type { AuditRepository } from '../db/audit-repository.ts';
import type { ConnectorRepository, ConnectorRow } from '../db/connector-repository.ts';
import type { GateSubject } from '../gate/subject.ts';
import { AppError } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import type { QuerySource } from '../query/executor.ts';
import { sqlFlavorOf } from '../query/sql-dialects.ts';
import type { SecretBox } from '../secrets/secret-box.ts';
import { validateSettings } from './validation.ts';
import { toDetail, toSchemaView, toSubject, toSummary } from './views.ts';

/** A new connector, as the API received it. */
type ConnectorInput = z.output<typeof connectorInputSchema>;

/** A change to a connector, as the API received it. */
type ConnectorPatch = z.output<typeof connectorPatchSchema>;

/** An open connector, ready for the query engine and the gate. */
export interface OpenConnector {
  /** The query engine's view: instance, language, guardrails, version. */
  readonly source: QuerySource;
  /** The gate's view: access level, hidden fields, descriptions. */
  readonly subject: GateSubject;
}

/** What the connectors service needs. */
export interface ConnectionsDependencies {
  /** The connector kinds on offer. */
  readonly kinds: readonly AnyConnectorKind[];
  /** Stores connectors. */
  readonly repository: ConnectorRepository;
  /** Records who changed what. */
  readonly audit: AuditRepository;
  /** Seals credentials. */
  readonly secretBox: SecretBox;
  /** The clock, in epoch milliseconds. */
  readonly now?: () => number;
}

/** The connectors service. Every method throws `AppError` `not_found` for an unknown id. */
export interface Connections {
  /**
   * Lists the kinds on offer.
   *
   * @returns Each kind with the JSON Schemas of its forms.
   */
  kinds(): ConnectorKindInfo[];
  /**
   * Lists the connectors.
   *
   * @returns Every connector, by name.
   */
  list(): ConnectorSummary[];
  /**
   * Reads a connector.
   *
   * @param id - The connector id.
   * @returns The connector, credentials masked.
   */
  get(id: string): Promise<ConnectorDetail>;
  /**
   * Creates a connector.
   *
   * @param input - The new connector.
   * @param actor - The principal id of whoever creates it.
   * @returns The connector, credentials masked.
   * @throws {AppError} `bad_request` for an unknown kind, invalid settings or a taken name.
   */
  create(input: ConnectorInput, actor: string): Promise<ConnectorDetail>;
  /**
   * Changes a connector. Given secret fields replace the stored ones; omitted ones stay.
   *
   * @param id - The connector id.
   * @param patch - The fields to change.
   * @param actor - The principal id of whoever changes it.
   * @returns The connector, credentials masked.
   * @throws {AppError} `bad_request` for invalid settings or a taken name.
   */
  update(id: string, patch: ConnectorPatch, actor: string): Promise<ConnectorDetail>;
  /**
   * Deletes a connector and closes its connection.
   *
   * @param id - The connector id.
   * @param actor - The principal id of whoever deletes it.
   * @returns When it is deleted.
   */
  remove(id: string, actor: string): Promise<void>;
  /**
   * Tests the connection.
   *
   * @param id - The connector id.
   * @param signal - Aborted when the caller gives up.
   * @returns The health report.
   */
  test(id: string, signal: AbortSignal): Promise<HealthReport>;
  /**
   * Reads the cached schema.
   *
   * @param id - The connector id.
   * @returns The schema view, empty when the schema was never read.
   */
  schema(id: string): SchemaView;
  /**
   * Reads the schema from the source and caches it.
   *
   * @param id - The connector id.
   * @param signal - Aborted when the caller gives up.
   * @returns The schema view.
   * @throws {AppError} `source_failed` when the source fails, with a message that quotes no data.
   */
  refreshSchema(id: string, signal: AbortSignal): Promise<SchemaView>;
  /**
   * Opens a connector by the name dashboards use.
   *
   * @param name - The connector name.
   * @returns The connector for the query engine and the gate.
   */
  open(name: string): Promise<OpenConnector>;
  /**
   * Says what dashboard validation needs of a connector, without opening it.
   *
   * @param name - The connector name.
   * @returns Its query language, SQL dialect and guardrails, or `undefined` when no usable
   *   connector has the name.
   */
  lookup(
    name: string,
  ): (Pick<QuerySource, 'language' | 'dialect'> & { guardrails: Guardrails }) | undefined;
  /**
   * The schema snapshot of a connector by name: the cached one, or read from the source and
   * cached when it was never read. For the gate, which decides what the model sees of it.
   *
   * @param name - The connector name.
   * @param signal - Aborted when the caller gives up.
   * @returns The snapshot.
   * @throws {AppError} `not_found` for an unknown name, `source_failed` when a read fails.
   */
  snapshot(name: string, signal: AbortSignal): Promise<SchemaSnapshot>;
  /**
   * The gate's view of every connector whose kind this server offers.
   *
   * @returns Each connector's subject and query language.
   */
  subjects(): { subject: GateSubject; language: QuerySource['language']; guide?: string }[];
  /**
   * Closes every open connection, at shutdown.
   *
   * @returns When they are closed.
   */
  closeAll(): Promise<void>;
}

/** The state the service functions share. */
interface ServiceContext extends ConnectionsDependencies {
  /** The clock. */
  readonly clock: () => number;
  /** Open connections by connector id, with the version they were opened at. */
  readonly instances: Map<
    string,
    { readonly version: number; readonly instance: ConnectorInstance }
  >;
}

/** Validates a cached schema snapshot. */
const snapshotSchema = z
  .object({ entities: z.array(z.unknown()) })
  .transform((value) => value as SchemaSnapshot);

/**
 * Describes a kind for the add form, with the JSON Schemas of its config and secret.
 *
 * @param kind - The connector kind.
 * @returns The kind information.
 */
function kindInfo(kind: AnyConnectorKind): ConnectorKindInfo {
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
  };
}

/**
 * Where a connector points, as its kind describes it.
 *
 * @param kind - The connector's kind.
 * @param config - The stored, parsed configuration.
 * @returns One line, or `null` when the kind does not describe targets.
 */
function targetOf(kind: AnyConnectorKind, config: unknown): string | null {
  return kind.describeTarget?.(config) ?? null;
}

/**
 * Finds a kind.
 *
 * @param context - The service context.
 * @param kind - The kind identifier.
 * @returns The kind.
 * @throws {AppError} `bad_request` for an unknown kind.
 */
function kindOf(context: ServiceContext, kind: string): AnyConnectorKind {
  const found = context.kinds.find((candidate) => candidate.kind === kind);
  if (!found) throw new AppError('bad_request', `Unknown connector kind "${kind}".`);
  return found;
}

/**
 * Finds a connector.
 *
 * @param context - The service context.
 * @param id - The connector id.
 * @returns The stored connector.
 * @throws {AppError} `not_found` when there is none.
 */
function find(context: ServiceContext, id: string): ConnectorRow {
  const row = context.repository.get(id);
  if (!row) throw new AppError('not_found', 'No connector has this id.');
  return row;
}

/**
 * Decrypts a connector's credentials.
 *
 * @param context - The service context.
 * @param row - The stored connector.
 * @returns The credentials.
 */
async function secretOf(
  context: ServiceContext,
  row: ConnectorRow,
): Promise<Record<string, unknown>> {
  return JSON.parse(await context.secretBox.open(row.secret, row.id)) as Record<string, unknown>;
}

/**
 * Checks that no other connector has a name.
 *
 * @param context - The service context.
 * @param name - The name.
 * @param id - The connector allowed to have it.
 * @throws {AppError} `bad_request` when another connector has it.
 */
function assertNameFree(context: ServiceContext, name: string, id?: string): void {
  const other = context.repository.getByName(name);
  if (!other || other.id === id) return;
  throw new AppError('bad_request', `A connector named "${name}" already exists.`, [
    { part: 'body', path: 'name', message: 'Taken.' },
  ]);
}

/**
 * Closes the open connection of a connector, if any.
 *
 * @param context - The service context.
 * @param id - The connector id.
 * @returns When it is closed.
 */
async function closeInstance(context: ServiceContext, id: string): Promise<void> {
  const open = context.instances.get(id);
  context.instances.delete(id);
  await open?.instance.close();
}

/**
 * The open connection of a connector, opened again when its settings changed.
 *
 * @param context - The service context.
 * @param row - The stored connector.
 * @returns The instance.
 */
async function instanceOf(context: ServiceContext, row: ConnectorRow): Promise<ConnectorInstance> {
  const open = context.instances.get(row.id);
  if (open && open.version === row.updatedAt) return open.instance;
  await closeInstance(context, row.id);
  const kind = kindOf(context, row.kind);
  const settings = validateSettings(kind, row.config, await secretOf(context, row));
  const instance = kind.open({ config: settings.config, secret: settings.secret });
  context.instances.set(row.id, { version: row.updatedAt, instance });
  return instance;
}

/**
 * Stores a connector with its credentials sealed for its id.
 *
 * @param context - The service context.
 * @param row - The connector without its sealed secret.
 * @param secret - The credentials.
 * @returns The stored connector.
 */
async function save(
  context: ServiceContext,
  row: Omit<ConnectorRow, 'secret'>,
  secret: unknown,
): Promise<ConnectorRow> {
  const stored = { ...row, secret: await context.secretBox.seal(JSON.stringify(secret), row.id) };
  context.repository.save(stored);
  return stored;
}

/**
 * Creates a connector.
 *
 * @param context - The service context.
 * @param input - The new connector.
 * @param actor - Who creates it.
 * @returns The connector, credentials masked.
 */
async function createConnector(
  context: ServiceContext,
  input: ConnectorInput,
  actor: string,
): Promise<ConnectorDetail> {
  const kind = kindOf(context, input.kind);
  const settings = validateSettings(kind, input.config, input.secret);
  assertNameFree(context, input.name);
  const time = context.clock();
  const { config: _config, secret: _secret, ...fields } = input;
  const row = {
    ...fields,
    id: newId(),
    kind: kind.kind,
    config: settings.config,
    createdAt: time,
    updatedAt: time,
  };
  const stored = await save(context, row, settings.secret);
  const detail = { name: stored.name, kind: stored.kind };
  context.audit.append({ actor, action: 'connector.create', target: stored.id, detail });
  return toDetail(
    stored,
    settings.secret as Record<string, unknown>,
    targetOf(kind, stored.config),
  );
}

/**
 * Applies a change to a stored connector, without its credentials.
 *
 * @param row - The stored connector.
 * @param patch - The change.
 * @param config - The validated configuration.
 * @param time - Now; the version always moves forward.
 * @returns The changed connector.
 */
function patched(
  row: ConnectorRow,
  patch: ConnectorPatch,
  config: unknown,
  time: number,
): Omit<ConnectorRow, 'secret'> {
  return {
    ...row,
    name: patch.name ?? row.name,
    config,
    accessLevel: patch.accessLevel ?? row.accessLevel,
    hiddenFields: patch.hiddenFields ?? row.hiddenFields,
    guardrails: patch.guardrails ?? row.guardrails,
    descriptions: patch.descriptions ?? row.descriptions,
    updatedAt: Math.max(time, row.updatedAt + 1),
  };
}

/**
 * Changes a connector. Given secret fields replace the stored ones; omitted ones stay.
 *
 * @param context - The service context.
 * @param id - The connector id.
 * @param patch - The change.
 * @param actor - Who changes it.
 * @returns The connector, credentials masked.
 */
async function updateConnector(
  context: ServiceContext,
  id: string,
  patch: ConnectorPatch,
  actor: string,
): Promise<ConnectorDetail> {
  const row = find(context, id);
  const secret = { ...(await secretOf(context, row)), ...(patch.secret ?? {}) };
  const kind = kindOf(context, row.kind);
  const settings = validateSettings(kind, patch.config ?? row.config, secret);
  if (patch.name !== undefined) assertNameFree(context, patch.name, id);
  const updated = await save(
    context,
    patched(row, patch, settings.config, context.clock()),
    settings.secret,
  );
  await closeInstance(context, id);
  const changed = Object.entries(patch).flatMap(([key, value]) =>
    value === undefined ? [] : [key],
  );
  context.audit.append({ actor, action: 'connector.update', target: id, detail: { changed } });
  return toDetail(
    updated,
    settings.secret as Record<string, unknown>,
    targetOf(kind, updated.config),
  );
}

/**
 * Deletes a connector.
 *
 * @param context - The service context.
 * @param id - The connector id.
 * @param actor - Who deletes it.
 * @returns When it is deleted.
 */
async function removeConnector(context: ServiceContext, id: string, actor: string): Promise<void> {
  const row = find(context, id);
  await closeInstance(context, id);
  context.repository.remove(id);
  context.audit.append({
    actor,
    action: 'connector.delete',
    target: id,
    detail: { name: row.name },
  });
}

/**
 * Reads the cached schema view of a connector.
 *
 * @param context - The service context.
 * @param id - The connector id.
 * @returns The schema view.
 */
function cachedSchema(context: ServiceContext, id: string): SchemaView {
  const row = find(context, id);
  const cached = context.repository.readSchema(id);
  const snapshot = cached ? snapshotSchema.parse(cached.snapshot) : undefined;
  return toSchemaView(row, snapshot, cached?.readAt ?? null);
}

/**
 * Turns a connector's failure into an error the admin can read.
 *
 * @param error - What the connector threw.
 * @returns Never.
 * @throws {AppError} `source_failed` with the connector's safe message, or the error itself.
 */
function asSourceFailure(error: unknown): never {
  if (!(error instanceof ConnectorError)) throw error;
  throw new AppError('source_failed', error.safeMessage, { code: error.code });
}

/**
 * Reads the schema from the source, caches it and returns its view.
 *
 * @param context - The service context.
 * @param id - The connector id.
 * @param signal - Aborted when the caller gives up.
 * @returns The schema view.
 * @throws {AppError} `source_failed` when the source fails.
 */
async function refreshSchema(
  context: ServiceContext,
  id: string,
  signal: AbortSignal,
): Promise<SchemaView> {
  const row = find(context, id);
  const snapshot = await (await instanceOf(context, row)).describe(signal).catch(asSourceFailure);
  const readAt = context.clock();
  context.repository.writeSchema(id, { snapshot, readAt });
  return toSchemaView(row, snapshot, readAt);
}

/**
 * Opens a connector by name for the query engine and the gate.
 *
 * @param context - The service context.
 * @param name - The connector name.
 * @returns The open connector.
 * @throws {AppError} `not_found` when no connector has the name.
 */
async function openConnector(context: ServiceContext, name: string): Promise<OpenConnector> {
  const row = context.repository.getByName(name);
  if (!row) throw new AppError('not_found', `No connector is named "${name}".`);
  const instance = await instanceOf(context, row);
  const kind = kindOf(context, row.kind);
  const source = {
    connectorId: row.id,
    version: row.updatedAt,
    language: kind.language,
    dialect: sqlFlavorOf(kind),
    instance,
    guardrails: row.guardrails,
  };
  return { source, subject: toSubject(row) };
}

/**
 * What dashboard validation needs of a connector.
 *
 * @param context - The service context.
 * @param name - The connector name.
 * @returns The language and guardrails, or `undefined` for an unknown name or kind.
 */
function lookupConnector(context: ServiceContext, name: string) {
  const row = context.repository.getByName(name);
  const kind = row && context.kinds.find((candidate) => candidate.kind === row.kind);
  if (!row || !kind) return undefined;
  return { language: kind.language, dialect: sqlFlavorOf(kind), guardrails: row.guardrails };
}

/**
 * The schema snapshot of a connector by name, read and cached when it was never read.
 *
 * @param context - The service context.
 * @param name - The connector name.
 * @param signal - Aborted when the caller gives up.
 * @returns The snapshot.
 */
async function snapshotByName(
  context: ServiceContext,
  name: string,
  signal: AbortSignal,
): Promise<SchemaSnapshot> {
  const row = context.repository.getByName(name);
  if (!row) throw new AppError('not_found', `No connector is named "${name}".`);
  const cached = context.repository.readSchema(row.id);
  if (cached) return snapshotSchema.parse(cached.snapshot);
  const snapshot = await (await instanceOf(context, row)).describe(signal).catch(asSourceFailure);
  context.repository.writeSchema(row.id, { snapshot, readAt: context.clock() });
  return snapshot;
}

/**
 * The gate's view of every connector whose kind this server offers.
 *
 * @param context - The service context.
 * @returns Each connector's subject and query language.
 */
function subjectsOf(context: ServiceContext) {
  return context.repository.list().flatMap((row) => {
    const kind = context.kinds.find((candidate) => candidate.kind === row.kind);
    if (!kind) return [];
    const guide = kind.queryGuide === undefined ? {} : { guide: kind.queryGuide };
    const flavor = sqlFlavorOf(kind);
    const dialect = flavor === undefined ? {} : { dialect: flavor };
    return [{ subject: toSubject(row), language: kind.language, ...dialect, ...guide }];
  });
}

/**
 * Creates the connectors service.
 *
 * @param dependencies - Kinds, repositories, and the secret box.
 * @returns The service.
 */
export function createConnections(dependencies: ConnectionsDependencies): Connections {
  const context: ServiceContext = {
    ...dependencies,
    clock: dependencies.now ?? Date.now,
    instances: new Map(),
  };
  return {
    kinds: () => context.kinds.map(kindInfo),
    list: () => context.repository.list().map(toSummary),
    get: async (id) => {
      const row = find(context, id);
      const target = targetOf(kindOf(context, row.kind), row.config);
      return toDetail(row, await secretOf(context, row), target);
    },
    create: (input, actor) => createConnector(context, input, actor),
    update: (id, patch, actor) => updateConnector(context, id, patch, actor),
    remove: (id, actor) => removeConnector(context, id, actor),
    test: async (id, signal) => (await instanceOf(context, find(context, id))).test(signal),
    schema: (id) => cachedSchema(context, id),
    refreshSchema: (id, signal) => refreshSchema(context, id, signal),
    open: (name) => openConnector(context, name),
    lookup: (name) => lookupConnector(context, name),
    snapshot: (name, signal) => snapshotByName(context, name, signal),
    subjects: () => subjectsOf(context),
    closeAll: async () => {
      await Promise.all([...context.instances.keys()].map((id) => closeInstance(context, id)));
    },
  };
}
