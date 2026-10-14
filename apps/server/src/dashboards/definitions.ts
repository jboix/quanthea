/**
 * Definitions: business terms with one meaning, saved by editors and admins as versions. A save is
 * checked as a whole: the definition's schema, no field hidden on a connector, and one test run of
 * each body, which tells only whether it ran and how many rows it found. Panels copy a body when
 * they are built, so a new version never changes a built panel.
 */
import {
  bodyLanguage,
  type Definition,
  type DefinitionBody,
  type DefinitionVersion,
  definitionSchema,
} from '@quanthea/shared';
import { z } from 'zod';
import type { AuditRepository } from '../db/audit-repository.ts';
import type {
  DefinitionOrigin,
  DefinitionRepository,
  DefinitionRow,
} from '../db/definition-repository.ts';
import { AppError } from '../lib/errors.ts';
import type { Dashboards } from './dashboards.ts';
import { previewData } from './query-preview.ts';

/** A connector as definitions see it: its name, its language, and which names it hides. */
export interface DefinitionConnector {
  /** The connector's name. */
  readonly name: string;
  /** Its query language. */
  readonly language: string;
  /**
   * Whether a field, column or label name is hidden on it from the model.
   *
   * @param name - The name.
   * @returns `true` when it is hidden.
   */
  readonly isHidden: (name: string) => boolean;
}

/** How one body's test run went: ran or not, and how many rows it found. */
export interface BodyTest {
  /** The body's language. */
  readonly language: string;
  /** The connector it ran on. */
  readonly connector: string;
  /** How many rows the test run found; zero is worth a look. */
  readonly rows: number;
}

/** Runs one data request once: how many rows it found, or why it did not run. */
export type RunData = (
  data: Readonly<Record<string, unknown>>,
) => Promise<
  { readonly ok: true; readonly rows: number } | { readonly ok: false; readonly message: string }
>;

/**
 * Runs a data request through the dashboards' preview, over the last day.
 *
 * @param dashboards - The dashboards, which build and test-run it.
 * @returns The runner.
 */
function previewRunner(dashboards: Pick<Dashboards, 'check' | 'testRun'>): RunData {
  return async (data) => {
    const preview = await previewData(dashboards, { data, saved: [], from: 'now-24h' });
    if (!preview.ok) return { ok: false, message: preview.message };
    const frames = preview.run.queries.flatMap((query) => query.frames);
    return { ok: true, rows: frames.reduce((sum, frame) => sum + frame.meta.rowCount, 0) };
  };
}

/** What the definitions service needs. */
export interface DefinitionsDependencies {
  /** The versions. */
  readonly repository: DefinitionRepository;
  /** The audit log. */
  readonly audit: Pick<AuditRepository, 'append'>;
  /** Builds and test-runs a body as a panel's data. */
  readonly dashboards: Pick<Dashboards, 'check' | 'testRun'>;
  /** Runs a body's data once; through the dashboards' preview when left out. */
  readonly runData?: RunData;
  /** The connectors there are. */
  readonly connectors: () => readonly DefinitionConnector[];
  /** The clock. */
  readonly now?: () => number;
}

/** The definitions service. */
export interface Definitions {
  /**
   * Lists the latest version of every definition.
   *
   * @returns The versions, by id.
   */
  list(): DefinitionVersion[];
  /**
   * Lists every version of a definition.
   *
   * @param id - The definition.
   * @returns The versions, the latest first.
   */
  history(id: string): DefinitionVersion[];
  /**
   * Checks and saves a definition as its next version.
   *
   * @param input - The definition, unchecked.
   * @param basedOn - The latest version the change started from, `null` for a new one.
   * @param actor - Who saves it.
   * @param origin - Where it comes from; the interface by default.
   * @returns The saved version, and each body's test run.
   * @throws {AppError} `bad_request` for an invalid definition, a hidden field or a body that does
   *   not run; `conflict` when another version was saved since.
   */
  save(
    input: unknown,
    basedOn: number | null,
    actor: string,
    origin?: DefinitionOrigin,
  ): Promise<{ version: DefinitionVersion; tests: BodyTest[] }>;
  /**
   * Deletes a definition, as a version that says so. Panels that copied it keep their copy.
   *
   * @param id - The definition.
   * @param basedOn - The latest version the change started from.
   * @param actor - Who deletes it.
   * @throws {AppError} `not_found` for an unknown definition; `conflict` as for a save.
   */
  remove(id: string, basedOn: number, actor: string): void;
}

/** The keys whose values name a field, a column or a label in a builder request. */
const fieldKeys = new Set(['field', 'column', 'by', 'time', 'series']);

/**
 * The field, column and label names a body's request holds, at any depth.
 *
 * @param value - The request, or a value inside it.
 * @returns The names.
 */
export function fieldNamesOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => fieldNamesOf(item));
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, item]) =>
    fieldKeys.has(key) && typeof item === 'string' ? [item] : fieldNamesOf(item),
  );
}

/**
 * The words of a meaning that could name a field: letters, digits, `_` and dotted paths.
 *
 * @param meaning - The meaning.
 * @returns The words.
 */
function wordsOf(meaning: string): string[] {
  return meaning.match(/[A-Za-z_][\w.]*/g) ?? [];
}

/**
 * Refuses a definition that names a field hidden on a connector: in a body, on the connectors of
 * its language; in its meaning, on any connector.
 *
 * @param definition - The definition.
 * @param connectors - The connectors there are.
 * @throws {AppError} `bad_request` naming the connector.
 */
function refuseHidden(definition: Definition, connectors: readonly DefinitionConnector[]): void {
  const meaning = wordsOf(definition.meaning);
  for (const connector of connectors) {
    if (meaning.some(connector.isHidden))
      throw new AppError('bad_request', `The meaning names a field hidden on ${connector.name}.`);
  }
  for (const body of definition.bodies) {
    const names = fieldNamesOf(body.request);
    const hiding = connectors.find(
      (each) => each.language === bodyLanguage(body) && names.some(each.isHidden),
    );
    if (hiding)
      throw new AppError(
        'bad_request',
        `A ${bodyLanguage(body)} body uses a field hidden on ${hiding.name}.`,
      );
  }
}

/**
 * The connector a body is tested on: the first it names, else the first of its language.
 *
 * @param body - The body.
 * @param connectors - The connectors there are.
 * @returns The connector's name.
 * @throws {AppError} `bad_request` when no connector speaks its language.
 */
function testConnector(body: DefinitionBody, connectors: readonly DefinitionConnector[]): string {
  const named = body.connectors?.[0];
  if (named) return named;
  const language = bodyLanguage(body);
  const first = connectors.find((connector) => connector.language === language);
  if (!first) throw new AppError('bad_request', `No connector speaks ${language}: add one first.`);
  return first.name;
}

/**
 * Runs a body once, as a panel's data, on the connector it is tested on.
 *
 * @param dependencies - The dashboards and the connectors.
 * @param body - The body.
 * @returns How it went.
 * @throws {AppError} `bad_request` with the reason when it does not build or run.
 */
async function testBody(
  dependencies: DefinitionsDependencies,
  body: DefinitionBody,
): Promise<BodyTest> {
  const connector = testConnector(body, dependencies.connectors());
  const run = dependencies.runData ?? previewRunner(dependencies.dashboards);
  const outcome = await run({ ...body.request, connector });
  const language = bodyLanguage(body);
  if (!outcome.ok)
    throw new AppError('bad_request', `The ${language} body does not run: ${outcome.message}`);
  const { rows } = outcome;
  return { language, connector, rows };
}

/**
 * Turns a stored version into a definition version.
 *
 * @param row - The stored version.
 * @returns The version.
 */
function versionOf(row: DefinitionRow): DefinitionVersion {
  const { version, actor: author, origin, createdAt } = row;
  return { definition: definitionSchema.parse(row.definition), version, author, origin, createdAt };
}

/**
 * Adds a version, or refuses a change that started from an older one.
 *
 * @param dependencies - The repository, the audit log and the clock.
 * @param row - The version, without its number.
 * @param basedOn - The version the change started from.
 * @returns The stored version.
 * @throws {AppError} `conflict` when another version was saved since.
 */
function addVersion(
  dependencies: DefinitionsDependencies,
  row: Omit<DefinitionRow, 'version' | 'createdAt'>,
  basedOn: number | null,
): DefinitionRow {
  const createdAt = (dependencies.now ?? Date.now)();
  const stored = dependencies.repository.add({ ...row, createdAt }, basedOn);
  if (!stored)
    throw new AppError('conflict', 'This definition changed since you opened it. Reload it.');
  const { actor, definitionId: target, version, deleted } = stored;
  dependencies.audit.append({
    actor,
    action: 'definition.version',
    target,
    detail: { version, deleted },
  });
  return stored;
}

/**
 * Checks and saves a definition.
 *
 * @param dependencies - What the service needs.
 * @param input - The definition, unchecked.
 * @param basedOn - The version the change started from.
 * @param who - Who saves it, and from where.
 * @returns The version and the tests.
 */
async function save(
  dependencies: DefinitionsDependencies,
  input: unknown,
  basedOn: number | null,
  who: { actor: string; origin: DefinitionOrigin },
) {
  const parsed = definitionSchema.safeParse(input);
  if (!parsed.success) throw new AppError('bad_request', z.prettifyError(parsed.error));
  const definition = parsed.data;
  refuseHidden(definition, dependencies.connectors());
  const tests = await Promise.all(definition.bodies.map((body) => testBody(dependencies, body)));
  const row = { definitionId: definition.id, definition, deleted: false, ...who };
  return { version: versionOf(addVersion(dependencies, row, basedOn)), tests };
}

/**
 * Creates the definitions service.
 *
 * @param dependencies - The versions, the audit log, the dashboards and the connectors.
 * @returns The service.
 */
export function createDefinitions(dependencies: DefinitionsDependencies): Definitions {
  const { repository } = dependencies;
  return {
    list: () => repository.current().map(versionOf),
    history: (id) => repository.history(id).map(versionOf),
    save: (input, basedOn, actor, origin = 'ui') =>
      save(dependencies, input, basedOn, { actor, origin }),
    remove: (id, basedOn, actor) => {
      const latest = repository.latest(id);
      if (!latest || latest.deleted) throw new AppError('not_found', `No definition "${id}".`);
      const row = { definitionId: id, definition: latest.definition, deleted: true };
      addVersion(dependencies, { ...row, origin: 'ui', actor }, basedOn);
    },
  };
}
