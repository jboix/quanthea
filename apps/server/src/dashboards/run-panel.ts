/**
 * Runs saved panels: resolves the time range and the variables, runs each query through the query
 * engine, and turns annotation results into markers. One failing query never fails the panel's
 * other queries.
 */
import {
  type Annotation,
  type DashboardSpec,
  type Frame,
  type MarkerOutcome,
  type PanelQuery,
  type PanelRun,
  type QueryOutcome,
  resolveTimeRange,
  type TimeRangeExpression,
  type VariableValues,
} from '@quanthea/shared';
import { AppError } from '../lib/errors.ts';
import type { QueryExecutor, QuerySource } from '../query/executor.ts';
import { QueryError } from '../query/query-error.ts';
import type { Variables } from '../query/variables.ts';
import { type QueryVariable, resolveVariables } from './variables.ts';

/** What running panels needs. */
export interface RunnerDependencies {
  /** Opens a connector by name. */
  readonly openSource: (name: string) => Promise<QuerySource>;
  /** Runs queries. */
  readonly executor: QueryExecutor;
  /** The current instant, in epoch milliseconds. */
  readonly now: () => number;
}

/** The viewer's choices for a run. */
export interface RunChoices {
  /** Variable values by name. */
  readonly variables: VariableValues;
  /** The time range, or the spec's default. */
  readonly time?: TimeRangeExpression | undefined;
}

/** The most markers one annotation draws. */
const maxMarkers = 200;

/** The most options a query-backed variable lists. */
const maxOptions = 1000;

/** A time range for the query engine. */
type EngineRange = { readonly from: Date; readonly to: Date };

/**
 * Why a query did not run, in words that quote no data.
 *
 * @param error - What the query threw.
 * @returns The failure.
 * @throws {unknown} Anything that is not a query or application error.
 */
function failureOf(error: unknown): NonNullable<QueryOutcome['error']> {
  if (error instanceof QueryError) return { code: error.code, message: error.safeMessage };
  if (error instanceof AppError) return { code: 'invalid', message: error.message };
  throw error;
}

/**
 * Runs one query.
 *
 * @param dependencies - The connectors and the executor.
 * @param query - The query.
 * @param variables - The resolved variables.
 * @param timeRange - The time range.
 * @param signal - Aborted when the caller gives up.
 * @returns The frames, or why it failed.
 */
async function runQuery(
  dependencies: RunnerDependencies,
  query: PanelQuery,
  variables: Variables,
  timeRange: EngineRange,
  signal?: AbortSignal,
): Promise<QueryOutcome> {
  try {
    const source = await dependencies.openSource(query.connector);
    const request = {
      refId: query.refId,
      template: query,
      variables,
      timeRange,
      ...(signal ? { signal } : {}),
    };
    const result = await dependencies.executor.run(source, request);
    return { refId: query.refId, frames: [...result.frames], error: null };
  } catch (error) {
    return { refId: query.refId, frames: [], error: failureOf(error) };
  }
}

/**
 * The values of a named field across frames.
 *
 * @param frames - The frames.
 * @param name - The field name.
 * @returns The values, in order.
 */
function columnOf(frames: readonly Frame[], name: string): unknown[] {
  return frames.flatMap((frame) => {
    const index = frame.fields.findIndex((field) => field.name === name);
    return index < 0 ? [] : (frame.values[index] ?? []);
  });
}

/**
 * Turns an annotation's frames into markers.
 *
 * @param annotation - The annotation.
 * @param frames - Its frames.
 * @returns At most {@link maxMarkers} points with a time and a text.
 */
function markersOf(annotation: Annotation, frames: readonly Frame[]): MarkerOutcome['points'] {
  const times = columnOf(frames, annotation.timeField);
  const texts = columnOf(frames, annotation.textField);
  return times
    .map((time, index) => ({ time: Number(time), text: String(texts[index] ?? '') }))
    .filter((point) => Number.isFinite(point.time))
    .slice(0, maxMarkers);
}

/**
 * The distinct values of the first text field, as a variable's options.
 *
 * @param frames - The frames of the variable's source.
 * @returns At most {@link maxOptions} options, in order of appearance.
 */
function optionsOf(frames: readonly Frame[]): string[] {
  const frame = frames[0];
  const index = frame?.fields.findIndex((field) => field.type === 'string') ?? -1;
  const values = frames.flatMap((each) => (index < 0 ? [] : (each.values[index] ?? [])));
  return [...new Set(values.map(String))].slice(0, maxOptions);
}

/**
 * Resolves the time range of a run.
 *
 * @param spec - The spec, for its default.
 * @param choices - The viewer's choices.
 * @param now - The current instant.
 * @returns The range as instants.
 * @throws {AppError} `bad_request` when it does not run forwards.
 */
function timeOf(spec: DashboardSpec, choices: RunChoices, now: number) {
  const range = resolveTimeRange(choices.time ?? spec.time, now);
  if (!(range.from < range.to))
    throw new AppError('bad_request', 'The time range ends before it starts.');
  return range;
}

/**
 * Builds the loader of query-backed variable options for one run.
 *
 * @param dependencies - The connectors and the executor.
 * @param timeRange - The time range.
 * @param signal - Aborted when the caller gives up.
 * @returns The loader. A failing source is a `source_failed` error.
 */
function optionsLoader(
  dependencies: RunnerDependencies,
  timeRange: EngineRange,
  signal?: AbortSignal,
) {
  return async (variable: QueryVariable, resolved: Variables): Promise<string[]> => {
    const query = { ...variable.source, refId: 'options' } as PanelQuery;
    const outcome = await runQuery(dependencies, query, resolved, timeRange, signal);
    if (outcome.error)
      throw new AppError('source_failed', `$${variable.name}: ${outcome.error.message}`);
    return optionsOf(outcome.frames);
  };
}

/**
 * Prepares a run: the time range, and the variables resolved against the spec.
 *
 * @param dependencies - The connectors, the executor and the clock.
 * @param spec - The spec.
 * @param choices - The viewer's choices.
 * @param signal - Aborted when the caller gives up.
 * @returns The range as instants and for the engine, and the variables' options loader.
 */
function prepare(
  dependencies: RunnerDependencies,
  spec: DashboardSpec,
  choices: RunChoices,
  signal?: AbortSignal,
) {
  const time = timeOf(spec, choices, dependencies.now());
  const timeRange = { from: new Date(time.from), to: new Date(time.to) };
  return { time, timeRange, loadOptions: optionsLoader(dependencies, timeRange, signal) };
}

/**
 * Runs one panel and the annotations its chart marks.
 *
 * @param dependencies - The connectors, the executor and the clock.
 * @param spec - The spec.
 * @param panelId - The panel.
 * @param choices - The viewer's variables and time range.
 * @param signal - Aborted when the caller gives up.
 * @returns The frames or failure of each query, and the markers.
 * @throws {AppError} `not_found` for an unknown panel, `bad_request` for invalid choices.
 */
export async function runPanel(
  dependencies: RunnerDependencies,
  spec: DashboardSpec,
  panelId: string,
  choices: RunChoices,
  signal?: AbortSignal,
): Promise<PanelRun> {
  const started = performance.now();
  const panel = spec.panels.find((candidate) => candidate.id === panelId);
  if (!panel) throw new AppError('not_found', `No panel "${panelId}" in this version.`);
  const { time, timeRange, loadOptions } = prepare(dependencies, spec, choices, signal);
  const variables = await resolveVariables(spec, choices.variables, loadOptions);
  const run = (query: PanelQuery) => runQuery(dependencies, query, variables, timeRange, signal);
  const marked = panel.view.kind === 'chart' ? (panel.view.markers ?? []) : [];
  const annotations = marked.flatMap(({ annotation }) =>
    spec.annotations.filter((each) => each.id === annotation),
  );
  const [queries, markers] = await Promise.all([
    Promise.all(panel.queries.map(run)),
    Promise.all(
      annotations.map(async (annotation) => {
        const outcome = await run(annotation.query);
        return {
          annotation: annotation.id,
          label: annotation.label,
          points: markersOf(annotation, outcome.frames),
          error: outcome.error,
        };
      }),
    ),
  ]);
  return { time, queries, markers, durationMs: Math.round(performance.now() - started) };
}

/**
 * Lists the options of a query-backed variable, bound with the choices for the variables before it.
 *
 * @param dependencies - The connectors, the executor and the clock.
 * @param spec - The spec.
 * @param name - The variable.
 * @param choices - The viewer's variables and time range.
 * @param signal - Aborted when the caller gives up.
 * @returns The options.
 * @throws {AppError} `not_found` when the spec has no such query-backed variable, `source_failed`
 *   when its source fails.
 */
export async function listVariableOptions(
  dependencies: RunnerDependencies,
  spec: DashboardSpec,
  name: string,
  choices: RunChoices,
  signal?: AbortSignal,
): Promise<string[]> {
  const variable = spec.variables.find((candidate) => candidate.name === name);
  if (variable?.kind !== 'query')
    throw new AppError('not_found', `No query-backed variable $${name}.`);
  const { loadOptions } = prepare(dependencies, spec, choices, signal);
  const resolved = await resolveVariables(spec, choices.variables, loadOptions, name);
  return loadOptions(variable, resolved);
}
