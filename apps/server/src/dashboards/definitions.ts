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
import { dataSchema } from './queries/index.ts';
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
   * Lists the definitions as the model may read them: a definition whose meaning names a field
   * now hidden on a connector is left out, and so is a body that uses one.
   *
   * @returns The versions, by id.
   */
  forModel(): DefinitionVersion[];
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
   * @param origin - Where it comes from; the interface by default. A definition from the file
   *   is checked but not test-run: its sources may not answer yet at startup.
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
  // A dotted path stays whole; a full stop that ends a sentence is not part of a word.
  return (meaning.match(/[A-Za-z_][\w.]*/g) ?? []).map((word) => word.replace(/\.+$/, ''));
}

/**
 * The connector that hides a field a body uses, among those of its language.
 *
 * @param body - The body.
 * @param connectors - The connectors there are.
 * @returns The connector, if one does.
 */
function hidingBody(
  body: DefinitionBody,
  connectors: readonly DefinitionConnector[],
): DefinitionConnector | undefined {
  const names = fieldNamesOf(body.request);
  const language = bodyLanguage(body);
  return connectors.find((each) => each.language === language && names.some(each.isHidden));
}

/**
 * The connector that hides a word of a meaning, if any.
 *
 * @param meaning - The meaning.
 * @param connectors - The connectors there are.
 * @returns The connector, if one does.
 */
function hidingMeaning(
  meaning: string,
  connectors: readonly DefinitionConnector[],
): DefinitionConnector | undefined {
  const words = wordsOf(meaning);
  return connectors.find((connector) => words.some(connector.isHidden));
}

/**
 * The definitions as the model may read them, as the connectors hide fields now.
 *
 * @param versions - The latest version of each definition.
 * @param connectors - The connectors there are.
 * @returns The versions the model may read, each with the bodies it may read.
 */
function visibleToModel(
  versions: readonly DefinitionVersion[],
  connectors: readonly DefinitionConnector[],
): DefinitionVersion[] {
  return versions.flatMap((version) => {
    const { definition } = version;
    if (hidingMeaning(definition.meaning, connectors)) return [];
    const bodies = definition.bodies.filter((body) => !hidingBody(body, connectors));
    return [{ ...version, definition: { ...definition, bodies } }];
  });
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
  const meaning = hidingMeaning(definition.meaning, connectors);
  if (meaning)
    throw new AppError('bad_request', `The meaning names a field hidden on ${meaning.name}.`);
  for (const body of definition.bodies) {
    const hiding = hidingBody(body, connectors);
    if (hiding)
      throw new AppError(
        'bad_request',
        `A ${bodyLanguage(body)} body uses a field hidden on ${hiding.name}.`,
      );
  }
}

/**
 * Refuses a body its builder's own schema refuses, so a mistake shows when it is saved, not when
 * a panel is built from it. The connector is the panel's, so any name stands in for it.
 *
 * @param definition - The definition.
 * @throws {AppError} `bad_request` naming the language and the problem.
 */
function refuseUnbuildable(definition: Definition): void {
  for (const body of definition.bodies) {
    const parsed = dataSchema.safeParse({ ...body.request, connector: 'connector' });
    if (!parsed.success)
      throw new AppError(
        'bad_request',
        `The ${bodyLanguage(body)} body is not a valid ${body.request.kind} request: ${z.prettifyError(parsed.error)}`,
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
  refuseUnbuildable(definition);
  refuseHidden(definition, dependencies.connectors());
  // The file is reviewed where it is written, and its sources may not answer yet at startup.
  const bodies = who.origin === 'file' ? [] : definition.bodies;
  const tests = await Promise.all(bodies.map((body) => testBody(dependencies, body)));
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
    forModel: () => visibleToModel(repository.current().map(versionOf), dependencies.connectors()),
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
