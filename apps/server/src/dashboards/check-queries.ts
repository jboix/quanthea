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
} from '@querent/shared';
import { isMultiValue, queryTextKey } from '@querent/shared';
import { bindTemplate } from '../query/bind.ts';
import type { QuerySource } from '../query/executor.ts';
import { checkTimeRange } from '../query/guardrails.ts';
import { QueryError } from '../query/query-error.ts';
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
}

/** Looks a connector up by name. */
export type ConnectorLookup = (name: string) => ConnectorFacts | undefined;

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
function queriesOf(spec: DashboardSpec): LocatedQuery[] {
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
 * Checks that a template binds with the declared variables.
 *
 * @param located - The query and its path.
 * @param connector - The query's connector.
 * @param variables - Sample values of the declared variables.
 * @param timeRange - The default time range.
 * @returns The issue, if any.
 */
function checkBinding(
  located: LocatedQuery,
  connector: ConnectorFacts,
  variables: Variables,
  timeRange: ResolvedTimeRange,
): SpecIssue[] {
  const { query, path } = located;
  const range = { from: new Date(timeRange.from), to: new Date(timeRange.to) };
  try {
    bindTemplate(query, variables, range, { dialect: connector.dialect });
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
function checkConnector(located: LocatedQuery, connector: ConnectorFacts | undefined): SpecIssue[] {
  const { query, path } = located;
  if (!connector)
    return [{ path: `${path}.connector`, message: `No connector is named "${query.connector}".` }];
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
    if (problems.length > 0 || !connector) return problems;
    used.set(located.query.connector, connector);
    return checkBinding(located, connector, variables, timeRange);
  });
  return [...issues, ...checkDefaultRange(used, timeRange)];
}
