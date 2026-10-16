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
import { type DefinitionConnector, refuseHidden, visibleToModel } from './definition-hidden.ts';
import { dataSchema } from './queries/index.ts';
import { previewData } from './query-preview.ts';

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

/** A definition that passed the checks of a save, unsaved. */
export interface CheckedDefinition {
  /** The definition. */
  readonly definition: Definition;
  /** Each body's test run. */
  readonly tests: readonly BodyTest[];
  /** The latest version of its id, which a save starts from; `null` for a new definition. */
  readonly latest: number | null;
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
   * Checks a definition as a save does, test-running each body, without saving it.
   *
   * @param input - The definition, unchecked.
   * @returns The definition, each body's test run, and the latest version of its id, `null` for a
   *   new one.
   * @throws {AppError} `bad_request` as for a save.
   */
  check(input: unknown): Promise<CheckedDefinition>;
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
  // A body holds no time column: a ratio is tested as one share over the whole range.
  const overRange = body.request.kind.endsWith('-ratio') ? { over: 'range' } : {};
  const outcome = await run({ ...body.request, ...overRange, connector });
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
 * Parses a definition and refuses one a save refuses before its test runs.
 *
 * @param dependencies - What the service needs.
 * @param input - The definition, unchecked.
 * @returns The definition.
 * @throws {AppError} `bad_request` for an invalid definition, a body its builder refuses, or a
 *   hidden field.
 */
function parsedDefinition(dependencies: DefinitionsDependencies, input: unknown): Definition {
  const parsed = definitionSchema.safeParse(input);
  if (!parsed.success) throw new AppError('bad_request', z.prettifyError(parsed.error));
  refuseUnbuildable(parsed.data);
  refuseHidden(parsed.data, dependencies.connectors());
  return parsed.data;
}

/**
 * Checks a definition and test-runs its bodies, without saving it.
 *
 * @param dependencies - What the service needs.
 * @param input - The definition, unchecked.
 * @returns The definition, its tests, and the latest version of its id.
 */
async function check(
  dependencies: DefinitionsDependencies,
  input: unknown,
): Promise<CheckedDefinition> {
  const definition = parsedDefinition(dependencies, input);
  const tests = await Promise.all(definition.bodies.map((body) => testBody(dependencies, body)));
  const latest = dependencies.repository.latest(definition.id);
  return { definition, tests, latest: latest && !latest.deleted ? latest.version : null };
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
  const definition = parsedDefinition(dependencies, input);
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
    check: (input) => check(dependencies, input),
    remove: (id, basedOn, actor) => {
      const latest = repository.latest(id);
      if (!latest || latest.deleted) throw new AppError('not_found', `No definition "${id}".`);
      const row = { definitionId: id, definition: latest.definition, deleted: true };
      addVersion(dependencies, { ...row, origin: 'ui', actor }, basedOn);
    },
  };
}
