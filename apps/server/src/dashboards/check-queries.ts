/**
 * Checks every query in a spec: its connector exists and speaks its language, its variables are
 * declared and in the right places, a variable's source uses only the variables before it, it is
 * a read statement, and the default time range fits the connector's guardrails.
 */
import type {
  DashboardSpec,
  Guardrails,
  PanelQuery,
  QueryTemplate,
  ResolvedTimeRange,
  Variable,
} from '@quanthea/shared';
import { isMultiValue, queryTextKey } from '@quanthea/shared';
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
 * Sample values for binding. A multi-value variable gets two values, so a template that uses it
 * where only one value fits is caught when the dashboard is saved.
 *
 * @param variable - The variable.
 * @returns A binding.
 */
function sampleBinding(variable: Variable) {
  if (variable.kind === 'text') return { value: variable.default };
  if (variable.kind === 'interval') return { value: variable.default, duration: true };
  const options = variable.kind === 'custom' ? variable.options : ['a', 'b'];
  const first = options[0] ?? 'a';
  return { value: isMultiValue(variable) ? [first, options[1] ?? first] : first };
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

/** What binding a variable's source needs besides its connector. */
interface SourceBinding {
  /** Sample values of every declared variable. */
  readonly variables: Variables;
  /** The default time range. */
  readonly timeRange: ResolvedTimeRange;
}

/**
 * What to say of a source that uses a variable resolved after it.
 *
 * @param name - The variable the source belongs to.
 * @param used - The variable its source uses.
 * @returns The message, naming both.
 */
function orderMessage(name: string, used: string): string {
  const rule = 'A source may use only the variables declared before it.';
  if (used === name) return `The source of "${name}" uses "${name}" itself. ${rule}`;
  return `The source of "${name}" uses "${used}", which is declared after it. ${rule} Declare "${used}" before "${name}".`;
}

/**
 * The connector a query can be bound on.
 *
 * @param located - The query and its path.
 * @param lookup - Finds a connector by name.
 * @returns Its facts, or `undefined` when it is missing, not installed or of another language.
 */
function boundOn(located: LocatedQuery, lookup: ConnectorLookup): ConnectorFacts | undefined {
  const connector = lookup(located.query.connector);
  if (!connector || 'notInstalled' in connector) return undefined;
  return checkConnector(located, connector).length === 0 ? connector : undefined;
}

/**
 * Checks a variable's source uses neither its own variable nor one declared after it. Variables
 * are resolved in the order declared, so such a source could never run. A source uses a variable
 * when it binds with every variable and no longer binds without that one. A source with an issue
 * of its own (its connector, an undeclared variable) is left to that issue.
 *
 * @param spec - A spec that passed the schema.
 * @param index - The place of a variable in the spec's variables.
 * @param lookup - Finds a connector by name.
 * @param binding - Sample values of every declared variable, and the default time range.
 * @returns One issue per variable used too early, at the source's text.
 */
function checkSourceOrder(
  spec: DashboardSpec,
  index: number,
  lookup: ConnectorLookup,
  binding: SourceBinding,
): SpecIssue[] {
  const variable = spec.variables[index];
  if (variable?.kind !== 'query') return [];
  const located = { query: variable.source, path: `variables[${index}].source` };
  const connector = boundOn(located, lookup);
  if (!connector) return [];
  const binds = (variables: Variables) =>
    checkBinding(located, connector, variables, binding.timeRange).length === 0;
  if (!binds(binding.variables)) return [];
  const path = `${located.path}.${queryTextKey(variable.source)}`;
  return spec.variables.slice(index).flatMap(({ name }) => {
    const { [name]: _without, ...others } = binding.variables;
    return binds(others) ? [] : [{ path, message: orderMessage(variable.name, name) }];
  });
}

/**
 * Checks every query of a spec.
 *
 * @param spec - A spec that passed the schema.
 * @param lookup - Finds a connector by name.
 * @param timeRange - The default time range, resolved.
 * @returns The issues.
 */
export function checkQueries(
  spec: DashboardSpec,
  lookup: ConnectorLookup,
  timeRange: ResolvedTimeRange,
): SpecIssue[] {
  const variables = Object.fromEntries(
    spec.variables.map((variable) => [variable.name, sampleBinding(variable)]),
  );
  const used = new Map<string, ConnectorFacts>();
  const issues = queriesOf(spec).flatMap((located) => {
    const connector = lookup(located.query.connector);
    const problems = checkConnector(located, connector);
    if (problems.length > 0 || !connector || 'notInstalled' in connector) return problems;
    used.set(located.query.connector, connector);
    return checkBinding(located, connector, variables, timeRange);
  });
  const order = spec.variables.flatMap((_variable, index) =>
    checkSourceOrder(spec, index, lookup, { variables, timeRange }),
  );
  return [...issues, ...order, ...checkDefaultRange(used, timeRange)];
}
