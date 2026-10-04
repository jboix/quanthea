/**
 * Validates an alert spec: the schema first, then what the schema cannot see. The connector
 * exists and speaks the query's language, the query binds with the alert's fixed variables, the
 * window fits the connector's guardrails, and the time zone is known. Issues come back with paths.
 */
import { type AlertSpec, alertSpecSchema, durationMs } from '@quanthea/shared';
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

/** What validation needs besides the spec. */
export interface AlertValidationContext {
  /** Finds a connector by name. */
  readonly lookup: ConnectorLookup;
  /** The current instant. */
  readonly now: number;
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
 * Checks the window against the connector's guardrails.
 *
 * @param connector - The connector.
 * @param window - The window.
 * @returns The issue, if any, at `lookback`.
 */
function checkWindow(connector: ConnectorFacts, window: { from: number; to: number }) {
  try {
    checkTimeRange({ from: new Date(window.from), to: new Date(window.to) }, connector.guardrails);
    return [];
  } catch (error) {
    if (!(error instanceof QueryError)) throw error;
    return [{ path: 'lookback', message: error.safeMessage }];
  }
}

/**
 * Checks the query of a parsed spec.
 *
 * @param spec - The spec.
 * @param context - The connectors and the current instant.
 * @returns The issues.
 */
function checkQuery(spec: AlertSpec, context: AlertValidationContext): SpecIssue[] {
  const located = { query: spec.query, path: 'query' };
  const connector = context.lookup(spec.query.connector);
  const problems = checkConnector(located, connector);
  if (problems.length > 0 || !connector || 'notInstalled' in connector) return problems;
  const window = windowAt(spec, context.now);
  return [
    ...checkBinding(located, connector, alertVariables(spec), window),
    ...checkWindow(connector, window),
  ];
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
  const issues = [...checkTimezone(spec.timezone), ...checkQuery(spec, context)];
  return issues.length > 0 ? { ok: false, issues } : { ok: true, spec };
}
