/**
 * Validates an alert spec: the schema first, then what the schema cannot see. The connector
 * exists and speaks the query's language, the query binds with the alert's fixed variables, the
 * window fits the connector's guardrails, and the time zone is known. The second query of a ratio
 * is checked the same way against its own connector. Issues come back with paths.
 */
import {
  type AlertSpec,
  alertSpecSchema,
  conditionTests,
  defaultChartInterval,
  durationMs,
  type PanelQuery,
  testPath,
} from '@quanthea/shared';
import {
  type ConnectorFacts,
  type ConnectorLookup,
  checkBinding,
  checkConnector,
} from '../dashboards/check-queries.ts';
import { pathOf, type SpecIssue } from '../dashboards/issues.ts';
import { checkTimezone } from '../dashboards/validate.ts';
import { checkTimeRange } from '../query/guardrails.ts';
import { QueryError } from '../query/query-error.ts';
import type { Variables } from '../query/variables.ts';
import { historyWindowAt } from './history.ts';

/** What validation needs besides the spec. */
export interface AlertValidationContext {
  /** Finds a connector by name. */
  readonly lookup: ConnectorLookup;
  /** The current instant. */
  readonly now: number;
  /** Whether a notification channel exists; channels are not checked without it. */
  readonly channelExists?: ((channelId: string) => boolean) | undefined;
}

/** The outcome of validation: a clean spec, or the issues. */
export type AlertValidation =
  | { readonly ok: true; readonly spec: AlertSpec }
  | { readonly ok: false; readonly issues: readonly SpecIssue[] };

/**
 * The bindings of an alert's fixed variables.
 *
 * @param spec - The spec.
 * @returns The variables, by name.
 */
export function alertVariables(spec: AlertSpec): Variables {
  return Object.fromEntries(
    spec.variables.map((variable) => [
      variable.name,
      { value: variable.value, ...(variable.interval ? { duration: true } : {}) },
    ]),
  );
}

/**
 * The window an evaluation at an instant queries.
 *
 * @param spec - The spec.
 * @param at - The evaluation.
 * @returns The window, ending at the evaluation.
 */
export function windowAt(spec: AlertSpec, at: number): { from: number; to: number } {
  return { from: at - durationMs(spec.lookback), to: at };
}

/**
 * The interval the time buckets of an alert's query are bound to: the one of the closed list its
 * lookback takes, such as `1m` under two hours. Every read binds the same one: an evaluation, the
 * history of a condition and a replay, so a bucket is as wide in a replay over a week as in a
 * check over the lookback. A PromQL or LogQL query takes none: each check reads it at an instant,
 * and a replay as a range query at the evaluation step.
 *
 * @param spec - The spec.
 * @param query - The alert's query, or the second query of a ratio.
 * @returns The interval, as a duration, or `undefined` for PromQL and LogQL.
 */
export function alertInterval(
  spec: Pick<AlertSpec, 'lookback'>,
  query: Pick<PanelQuery, 'language'>,
): string | undefined {
  if (query.language === 'promql' || query.language === 'logql') return undefined;
  return defaultChartInterval(durationMs(spec.lookback));
}

/**
 * Checks a window against the connector's guardrails.
 *
 * @param connector - The connector.
 * @param window - The window.
 * @param path - Where the issue goes: the field that sets the window's length.
 * @returns The issue, if any.
 */
function checkWindow(
  connector: ConnectorFacts,
  window: { from: number; to: number },
  path: string,
): SpecIssue[] {
  try {
    checkTimeRange({ from: new Date(window.from), to: new Date(window.to) }, connector.guardrails);
    return [];
  } catch (error) {
    if (!(error instanceof QueryError)) throw error;
    return [{ path, message: error.safeMessage }];
  }
}

/**
 * Checks the baseline of a band against the connector's guardrails: its query covers the whole
 * baseline. The window of a comparison with the past is as long as the alert's own.
 *
 * @param spec - The spec.
 * @param connector - The connector.
 * @param now - The current instant.
 * @returns The issue, if any, at the band's `baseline`.
 */
function checkBaseline(spec: AlertSpec, connector: ConnectorFacts, now: number): SpecIssue[] {
  const index = conditionTests(spec.condition).findIndex((test) => test.kind === 'band');
  const window = historyWindowAt(spec, now);
  if (index < 0 || !window) return [];
  return checkWindow(connector, window, pathOf(testPath(spec.condition, index, 'baseline')));
}

/**
 * The built-ins whose value follows the length of the time range: the durations of PromQL and
 * LogQL. The interval of a bucketed language is the alert's own, the same over any range.
 */
const rangeBuiltIns = /\$(?:\{)?__(?:rate_interval|interval|range)\b/;

/**
 * Checks the query of a band for a built-in that follows the time range. The band's history query
 * runs over the baseline, where such a built-in takes another value than over the window, so the
 * points of the baseline would be on another scale than the value they judge.
 *
 * @param spec - The spec.
 * @returns The issue, if any, at `query`.
 */
function checkBandQuery(spec: AlertSpec): SpecIssue[] {
  const { query } = spec;
  const band = conditionTests(spec.condition).some((test) => test.kind === 'band');
  if (!band || (query.language !== 'promql' && query.language !== 'logql')) return [];
  const found = rangeBuiltIns.exec(query.expr)?.[0].replace(/^\$\{?/, '');
  if (found === undefined) return [];
  const message = `A band reads the query over its baseline too, where ${found} takes another value than over the window, so the band would be on another scale than the value. Write the duration itself, such as 5m.`;
  return [{ path: 'query', message }];
}

/**
 * Checks one query of a parsed spec against its own connector: the connector exists and speaks
 * the query's language, the query binds with the alert's variables, and the window fits the
 * connector's guardrails.
 *
 * @param spec - The spec.
 * @param located - The query and its path in the spec.
 * @param context - The connectors and the current instant.
 * @returns The issues, and the connector when it can be queried.
 */
function checkOneQuery(
  spec: AlertSpec,
  located: { readonly query: PanelQuery; readonly path: string },
  context: AlertValidationContext,
): { readonly issues: SpecIssue[]; readonly connector?: ConnectorFacts } {
  const connector = context.lookup(located.query.connector);
  const problems = checkConnector(located, connector);
  if (problems.length > 0 || !connector || 'notInstalled' in connector) return { issues: problems };
  const window = windowAt(spec, context.now);
  const issues = [
    ...checkBinding(located, connector, alertVariables(spec), window),
    ...checkWindow(connector, window, 'lookback'),
  ];
  return { issues, connector };
}

/**
 * Checks the queries of a parsed spec: its query, and the second query of a ratio, each against
 * its own connector.
 *
 * @param spec - The spec.
 * @param context - The connectors and the current instant.
 * @returns The issues.
 */
function checkQuery(spec: AlertSpec, context: AlertValidationContext): SpecIssue[] {
  const first = checkOneQuery(spec, { query: spec.query, path: 'query' }, context);
  const baseline = first.connector ? checkBaseline(spec, first.connector, context.now) : [];
  const second = spec.dividedBy
    ? checkOneQuery(spec, { query: spec.dividedBy.query, path: 'dividedBy.query' }, context).issues
    : [];
  return [...first.issues, ...checkBandQuery(spec), ...baseline, ...second];
}

/**
 * Validates an alert spec.
 *
 * @param input - The spec, as JSON.
 * @param context - The connectors and the current instant.
 * @returns The parsed spec, or every issue found.
 */
export function validateAlertSpec(
  input: unknown,
  context: AlertValidationContext,
): AlertValidation {
  const parsed = alertSpecSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      path: pathOf(issue.path),
      message: issue.message,
    }));
    return { ok: false, issues };
  }
  const spec = parsed.data;
  const issues = [
    ...checkTimezone(spec.timezone),
    ...checkChannels(spec, context),
    ...checkQuery(spec, context),
  ];
  return issues.length > 0 ? { ok: false, issues } : { ok: true, spec };
}

/**
 * Checks that every channel the spec names exists, when the context can tell.
 *
 * @param spec - The spec.
 * @param context - Whether a channel exists, if the caller checks channels.
 * @returns An issue per unknown channel, at `channels[i]`.
 */
function checkChannels(spec: AlertSpec, context: AlertValidationContext): SpecIssue[] {
  const { channelExists } = context;
  if (!channelExists) return [];
  return spec.channels.flatMap((id, index) =>
    channelExists(id)
      ? []
      : [{ path: `channels[${index}]`, message: `No notification channel has the id "${id}".` }],
  );
}
