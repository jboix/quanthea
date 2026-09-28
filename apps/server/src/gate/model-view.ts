/**
 * The connectors as the model sees them: every answer the agent's data tools give passes through
 * here, shaped by each connector's access level and hidden fields. The gate declares what it needs
 * from the connectors service; the bootstrap hands it over, so the gate never imports it.
 */
import type { AccessLevel, Frame } from '@querent/shared';
import type { SchemaSnapshot } from '../connectors/_shared/index.ts';
import type { QueryExecutor, QueryRequest, QuerySource } from '../query/executor.ts';
import { type ModelEntity, modelSchema } from './model-schema.ts';
import { type ModelSample, sampleForModel } from './sample.ts';
import type { GateSubject } from './subject.ts';
import { type ModelTestResult, modelTestResult, testQueryForModel } from './test-run.ts';

/** What the gate needs from the connectors service. */
export interface ConnectorAccess {
  /**
   * Lists the connectors, as the gate sees them.
   *
   * @returns Their subjects and query languages.
   */
  list(): readonly { readonly subject: GateSubject; readonly language: QuerySource['language'] }[];
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
 * Creates the model's view of the connectors.
 *
 * @param access - What the connectors service provides.
 * @param executor - Runs test queries.
 * @returns The view.
 */
export function createModelView(access: ConnectorAccess, executor: QueryExecutor): ModelView {
  const subjects = () => new Map(access.list().map(({ subject }) => [subject.name, subject]));
  return {
    connectors: () =>
      access.list().map(({ subject, language }) => ({
        name: subject.name,
        kind: subject.kind,
        language,
        accessLevel: subject.accessLevel,
        access: levelMeanings[subject.accessLevel],
      })),
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
        ? modelTestResult(subject, outcome.frames)
        : { ok: false, error: outcome.error };
    },
  };
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
