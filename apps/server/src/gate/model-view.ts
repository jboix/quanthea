/**
 * The connectors as the model sees them: every answer the agent's data tools give passes through
 * here, shaped by each connector's access level and hidden fields. The gate declares what it needs
 * from the connectors service; the bootstrap hands it over, so the gate never imports it.
 */
import type { AccessLevel, Frame } from '@quanthea/shared';
import type { SchemaSnapshot } from '../connectors/_shared/index.ts';
import type { QueryExecutor, QueryRequest, QuerySource } from '../query/executor.ts';
import { buildCatalog, createValueCache, type ValueCache } from './catalog.ts';
import { type ModelEntity, modelSchema } from './model-schema.ts';
import { type ModelSample, sampleForModel } from './sample.ts';
import type { GateSubject } from './subject.ts';
import { type ModelTestResult, modelPanelResult, testQueryForModel } from './test-run.ts';

/** What the gate needs from the connectors service. */
export interface ConnectorAccess {
  /**
   * Lists the connectors, as the gate sees them.
   *
   * @returns Their subjects, query languages and SQL dialects.
   */
  list(): readonly {
    readonly subject: GateSubject;
    readonly language: QuerySource['language'];
    readonly dialect?: QuerySource['dialect'];
    readonly guide?: string;
  }[];
  /**
   * Opens a connector by name.
   *
   * @param name - The connector name.
   * @returns The query engine's and the gate's views of it.
   * @throws {Error} When no connector has the name.
   */
  open(name: string): Promise<{ readonly source: QuerySource; readonly subject: GateSubject }>;
  /**
   * The schema snapshot of a connector.
   *
   * @param name - The connector name.
   * @param signal - Aborted when the caller gives up.
   * @returns The snapshot.
   */
  snapshot(name: string, signal: AbortSignal): Promise<SchemaSnapshot>;
}

/** A connector in the model's list. */
export interface ModelConnector {
  /** The name queries use. */
  readonly name: string;
  /** The kind, such as `postgres`. */
  readonly kind: string;
  /** The query language. */
  readonly language: QuerySource['language'];
  /** The SQL dialect, when it runs SQL. */
  readonly dialect?: QuerySource['dialect'];
  /** The access level. */
  readonly accessLevel: AccessLevel;
  /** What the access level lets the model see. */
  readonly access: string;
}

/** A schema as the model sees it, possibly cut to a scope. */
export type ModelDescription =
  | { readonly ok: true; readonly entities: readonly ModelEntity[]; readonly more: number }
  | { readonly ok: false; readonly error: string };

/** The connectors as the model sees them. */
export interface ModelView {
  /**
   * Lists the connectors.
   *
   * @returns Name, kind, language and access of each.
   */
  connectors(): ModelConnector[];
  /**
   * The query guides of the connector kinds in use: how to get each shape of data from them.
   *
   * @returns One guide per kind that has one.
   */
  guides(): { readonly kind: string; readonly text: string }[];
  /**
   * The catalog: every connector's schema in compact lines, with the values of its
   * low-cardinality fields, as far as each access level allows.
   *
   * @param signal - Aborted when the caller gives up.
   * @param question - The person's questions, to trim big connectors to what they are about.
   * @returns The catalog text.
   */
  catalog(signal: AbortSignal, question?: string): Promise<string>;
  /**
   * Describes a connector's schema.
   *
   * @param name - The connector.
   * @param scope - Only entities whose name contains this text, if given.
   * @param signal - Aborted when the caller gives up.
   * @returns At most {@link maxEntities} entities, and how many more matched.
   */
  describe(name: string, scope: string | undefined, signal: AbortSignal): Promise<ModelDescription>;
  /**
   * Lists distinct values of a field.
   *
   * @param name - The connector.
   * @param field - The entity and field.
   * @param limit - The most values.
   * @param signal - Aborted when the caller gives up.
   * @returns The values, or why not.
   */
  sample(
    name: string,
    field: { entity: string; field: string },
    limit: number,
    signal: AbortSignal,
  ): Promise<ModelSample>;
  /**
   * Test-runs a query.
   *
   * @param name - The connector.
   * @param request - The query, its variables and its time range.
   * @returns What the access level lets through of the result.
   */
  testQuery(name: string, request: QueryRequest): Promise<ModelTestResult>;
  /**
   * Shapes a saved panel's result for the model.
   *
   * @param name - The connector the query ran on.
   * @param outcome - Its frames, or its error message (already free of data).
   * @returns What the access level lets through.
   */
  panelResult(
    name: string,
    outcome: { frames: readonly Frame[]; error: string | null },
  ): ModelTestResult;
}

/** The most entities one description returns. */
const maxEntities = 60;

/** What each access level lets the model see, in words. */
const levelMeanings: Readonly<Record<AccessLevel, string>> = {
  1: 'level 1, schema only: test runs say ok or the error',
  2: 'level 2, schema and metadata: test runs return shapes and row counts, never values',
  3: 'level 3, aggregates: test runs also return min, max, mean, spikes and top values',
  4: 'level 4, full access: test runs return rows',
};

/**
 * A safe message for a failure to reach a connector.
 *
 * @param name - The connector name.
 * @returns The message.
 */
function unreachable(name: string): string {
  return `Cannot use connector "${name}": it does not exist or cannot be reached.`;
}

/**
 * The connectors in the model's words.
 *
 * @param access - The connectors service.
 * @returns Name, kind, language and access of each.
 */
function modelConnectors(access: ConnectorAccess): ModelConnector[] {
  return access.list().map(({ subject, language, dialect }) => ({
    name: subject.name,
    kind: subject.kind,
    language,
    ...(dialect === undefined ? {} : { dialect }),
    accessLevel: subject.accessLevel,
    access: levelMeanings[subject.accessLevel],
  }));
}

/**
 * The query guides of the connector kinds in use, once per kind.
 *
 * @param access - The connectors.
 * @returns The guides.
 */
function guidesOf(access: ConnectorAccess): { kind: string; text: string }[] {
  const byKind = new Map<string, string>();
  for (const { subject, guide } of access.list()) if (guide) byKind.set(subject.kind, guide);
  return [...byKind].map(([kind, text]) => ({ kind, text }));
}

/**
 * Creates the model's view of the connectors.
 *
 * @param access - What the connectors service provides.
 * @param executor - Runs test queries.
 * @returns The view.
 */
export function createModelView(access: ConnectorAccess, executor: QueryExecutor): ModelView {
  const subjects = () => new Map(access.list().map(({ subject }) => [subject.name, subject]));
  const values = createValueCache();
  return {
    catalog: (signal, question) => catalogOf(access, values, signal, question),
    connectors: () => modelConnectors(access),
    guides: () => guidesOf(access),
    describe: (name, scope, signal) =>
      describeFor(access, subjects().get(name), name, scope, signal),
    async sample(name, field, limit, signal) {
      const opened = await access.open(name).catch(() => undefined);
      if (!opened) return { ok: false, error: unreachable(name) };
      return sampleForModel(opened.subject, opened.source.instance, field, limit, signal);
    },
    async testQuery(name, request) {
      const opened = await access.open(name).catch(() => undefined);
      if (!opened) return { ok: false, error: unreachable(name) };
      return testQueryForModel(opened.subject, executor, opened.source, request);
    },
    panelResult(name, outcome) {
      const subject = subjects().get(name);
      if (!subject) return { ok: false, error: unreachable(name) };
      return outcome.error === null
        ? modelPanelResult(subject, outcome.frames)
        : { ok: false, error: outcome.error };
    },
  };
}

/**
 * Reads every connector for the catalog: its schema and an instance to sample from.
 *
 * @param access - The connectors service.
 * @param values - The value cache.
 * @param signal - Aborted when the caller gives up.
 * @param question - The person's questions in the thread.
 * @returns The catalog text.
 */
async function catalogOf(
  access: ConnectorAccess,
  values: ValueCache,
  signal: AbortSignal,
  question = '',
): Promise<string> {
  const sources = await Promise.all(
    access.list().map(async ({ subject, language }) => {
      const snapshot = await access.snapshot(subject.name, signal).catch(() => undefined);
      const opened = await access.open(subject.name).catch(() => undefined);
      const words = levelMeanings[subject.accessLevel];
      return { subject, language, access: words, snapshot, instance: opened?.source.instance };
    }),
  );
  return buildCatalog(sources, values, signal, question);
}

/**
 * Describes a connector for the model, cut to a scope and a size.
 *
 * @param access - The connectors service.
 * @param subject - The connector, if it exists.
 * @param name - Its name.
 * @param scope - The text entity names must contain, if any.
 * @param signal - Aborted when the caller gives up.
 * @returns The description.
 */
async function describeFor(
  access: ConnectorAccess,
  subject: GateSubject | undefined,
  name: string,
  scope: string | undefined,
  signal: AbortSignal,
): Promise<ModelDescription> {
  if (!subject) return { ok: false, error: unreachable(name) };
  const snapshot = await access.snapshot(name, signal).catch(() => undefined);
  if (!snapshot) return { ok: false, error: `The schema of "${name}" cannot be read right now.` };
  const needle = scope?.toLowerCase();
  const entities = modelSchema(subject, snapshot).filter(
    (entity) => !needle || entity.name.toLowerCase().includes(needle),
  );
  return {
    ok: true,
    entities: entities.slice(0, maxEntities),
    more: Math.max(0, entities.length - maxEntities),
  };
}
