/**
 * Checks every query in a spec: its connector exists and speaks its language, its variables are
 * declared and in the right places, it is a read statement, and the default time range fits the
 * connector's guardrails.
 */
import type {
  DashboardSpec,
  Guardrails,
  PanelQuery,
  QueryTemplate,
  ResolvedTimeRange,
  Variable,
} from '@quanthea/shared';
import { isMultiValue, offersAll, queryTextKey } from '@quanthea/shared';
import { bindTemplate } from '../query/bind.ts';
import type { QuerySource } from '../query/executor.ts';
import { checkTimeRange } from '../query/guardrails.ts';
import { QueryError } from '../query/query-error.ts';
import { checkScope } from '../query/scope/check.ts';
import type { Variables } from '../query/variables.ts';
import type { SpecIssue } from './issues.ts';

/** What the validator needs to know of a connector. */
export interface ConnectorFacts {
  /** The query language of its kind. */
  readonly language: QuerySource['language'];
  /** The SQL dialect of its kind, when it runs SQL. */
  readonly dialect?: QuerySource['dialect'];
  /** Its guardrails. */
  readonly guardrails: Guardrails;
  /** Which objects it shows; a query that names another is an issue. Not checked when absent. */
  readonly scope?: QuerySource['scope'] | undefined;
  /** Whether a search on it may hold a script of its own in its two bucket aggregations. */
  readonly bucketScripts?: boolean | undefined;
}

/** A connector whose kind is not offered, because the plugin that added it is gone. */
export interface MissingKind {
  /** What to tell people, such as `The plugin that adds the kind … is not installed.` */
  readonly notInstalled: string;
}

/**
 * Looks a connector up by name: its facts, why it cannot run, or `undefined` when there is none.
 */
export type ConnectorLookup = (name: string) => ConnectorFacts | MissingKind | undefined;

/** A query and where it sits in the spec. */
interface LocatedQuery {
  /** The template. */
  readonly query: QueryTemplate | PanelQuery;
  /** Its path, such as `panels[0].queries[1]`. */
  readonly path: string;
}

/**
 * Every query of a spec, with its path.
 *
 * @param spec - The spec.
 * @returns Panel queries, annotation queries and variable sources.
 */
export function queriesOf(spec: DashboardSpec): LocatedQuery[] {
  const panels = spec.panels.flatMap((panel, panelIndex) =>
    panel.queries.map((query, index) => ({
      query,
      path: `panels[${panelIndex}].queries[${index}]`,
    })),
  );
  const annotations = spec.annotations.map((annotation, index) => ({
    query: annotation.query,
    path: `annotations[${index}].query`,
  }));
  const variables = spec.variables.flatMap((variable, index) =>
    variable.kind === 'query'
      ? [{ query: variable.source, path: `variables[${index}].source` }]
      : [],
  );
  return [...panels, ...annotations, ...variables];
}

/**
 * Whether a variable may hold several values when a query runs. A variable marked `multi` does.
 * So does a variable with an "All" choice, which binds every option, but a version
 * stored before this was checked must still pin, so it counts only when the spec is written.
 *
 * @param variable - The variable.
 * @param writing - Whether the spec is being written, and not read from a stored version.
 * @returns Whether to sample it as a list.
 */
function holdsSeveral(variable: Variable, writing: boolean): boolean {
  if (isMultiValue(variable)) return true;
  return writing && offersAll(variable);
}

/**
 * Sample values for binding. A variable that may hold several values gets two, so a template that
 * uses it where only one value fits is caught when the dashboard is saved.
 *
 * @param variable - The variable.
 * @param writing - Whether the spec is being written, and not read from a stored version.
 * @returns A binding.
 */
function sampleBinding(variable: Variable, writing: boolean) {
  if (variable.kind === 'text') return { value: variable.default };
  if (variable.kind === 'interval') return { value: variable.default, duration: true };
  const options = variable.kind === 'custom' ? variable.options : ['a', 'b'];
  const first = options[0] ?? 'a';
  return { value: holdsSeveral(variable, writing) ? [first, options[1] ?? first] : first };
}

/**
 * Sample values of every variable a spec declares.
 *
 * @param spec - The spec.
 * @param writing - Whether the spec is being written, and not read from a stored version.
 * @returns The bindings, by variable name.
 */
export function sampleVariables(spec: DashboardSpec, writing = false): Variables {
  return Object.fromEntries(
    spec.variables.map((variable) => [variable.name, sampleBinding(variable, writing)]),
  );
}

/**
 * Checks that a template binds with the declared variables, and names no object its connector
 * hides.
 *
 * @param located - The query and its path.
 * @param connector - The query's connector.
 * @param variables - Sample values of the declared variables.
 * @param timeRange - The default time range.
 * @returns The issue, if any.
 */
export function checkBinding(
  located: LocatedQuery,
  connector: ConnectorFacts,
  variables: Variables,
  timeRange: ResolvedTimeRange,
): SpecIssue[] {
  const { query, path } = located;
  const range = { from: new Date(timeRange.from), to: new Date(timeRange.to) };
  try {
    const { dialect, scope, bucketScripts } = connector;
    const showSystem = scope?.visibility.showSystem;
    const bound = bindTemplate(query, variables, range, { dialect, showSystem, bucketScripts });
    if (scope) checkScope(scope, bound, dialect);
    return [];
  } catch (error) {
    if (!(error instanceof QueryError)) throw error;
    return [{ path: `${path}.${queryTextKey(query)}`, message: error.safeMessage }];
  }
}

/**
 * Checks one query against its connector.
 *
 * @param located - The query and its path.
 * @param connector - The connector, if it exists.
 * @returns The issues.
 */
export function checkConnector(
  located: LocatedQuery,
  connector: ConnectorFacts | MissingKind | undefined,
): SpecIssue[] {
  const { query, path } = located;
  if (!connector)
    return [{ path: `${path}.connector`, message: `No connector is named "${query.connector}".` }];
  if ('notInstalled' in connector)
    return [{ path: `${path}.connector`, message: connector.notInstalled }];
  if (connector.language === query.language) return [];
  return [
    {
      path: `${path}.language`,
      message: `"${query.connector}" runs ${connector.language}, not ${query.language}.`,
    },
  ];
}

/**
 * Checks the default time range against the guardrails of every connector the spec uses.
 *
 * @param connectors - The connectors used, by name.
 * @param timeRange - The default time range.
 * @returns The issues, at `time`.
 */
function checkDefaultRange(
  connectors: ReadonlyMap<string, ConnectorFacts>,
  timeRange: ResolvedTimeRange,
): SpecIssue[] {
  const range = { from: new Date(timeRange.from), to: new Date(timeRange.to) };
  return [...connectors].flatMap(([name, connector]) => {
    try {
      checkTimeRange(range, connector.guardrails);
      return [];
    } catch (error) {
      if (!(error instanceof QueryError)) throw error;
      return [{ path: 'time', message: `${name}: ${error.safeMessage}` }];
    }
  });
}

/**
 * Checks every query of a spec.
 *
 * @param spec - A spec that passed the schema.
 * @param lookup - Finds a connector by name.
 * @param timeRange - The default time range, resolved.
 * @param writing - Whether the spec is being written, and not read from a stored version.
 * @returns The issues.
 */
export function checkQueries(
  spec: DashboardSpec,
  lookup: ConnectorLookup,
  timeRange: ResolvedTimeRange,
  writing = false,
): SpecIssue[] {
  const variables = sampleVariables(spec, writing);
  const used = new Map<string, ConnectorFacts>();
  const issues = queriesOf(spec).flatMap((located) => {
    const connector = lookup(located.query.connector);
    const problems = checkConnector(located, connector);
    if (problems.length > 0 || !connector || 'notInstalled' in connector) return problems;
    used.set(located.query.connector, connector);
    return checkBinding(located, connector, variables, timeRange);
  });
  return [...issues, ...checkDefaultRange(used, timeRange)];
}
