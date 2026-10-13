/**
 * Checks the order of a spec's variables: the source of a query-backed variable uses only the
 * variables declared before it. Variables are resolved in the order declared, so a source that
 * uses its own variable or a later one runs without that value: its options never load, and a
 * variable without a default never binds.
 *
 * The check is for a spec being written. A stored version may hold such a source and still draw,
 * when the variable has a default, so reading, pinning, restoring and copying it do not run this.
 */
import type { DashboardSpec, ResolvedTimeRange } from '@quanthea/shared';
import { queryTextKey } from '@quanthea/shared';
import type { Variables } from '../query/variables.ts';
import {
  type ConnectorFacts,
  type ConnectorLookup,
  checkBinding,
  checkConnector,
  sampleVariables,
} from './check-queries.ts';
import type { SpecIssue } from './issues.ts';

/** A query-backed variable's source and where it sits in the spec. */
type LocatedSource = Parameters<typeof checkBinding>[0];

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
 * The connector a source can be bound on.
 *
 * @param located - The source and its path.
 * @param lookup - Finds a connector by name.
 * @returns Its facts, or `undefined` when it is missing, not installed or of another language.
 */
function boundOn(located: LocatedSource, lookup: ConnectorLookup): ConnectorFacts | undefined {
  const connector = lookup(located.query.connector);
  if (!connector || 'notInstalled' in connector) return undefined;
  return checkConnector(located, connector).length === 0 ? connector : undefined;
}

/**
 * Checks one variable's source uses neither its own variable nor one declared after it. A source
 * uses a variable when it binds with every variable and no longer binds without that one. A source
 * with an issue of its own (its connector, an undeclared variable) is left to that issue.
 *
 * @param spec - A spec that passed the schema.
 * @param index - The place of a variable in the spec's variables.
 * @param lookup - Finds a connector by name.
 * @param timeRange - The default time range.
 * @returns One issue per variable used too early, at the source's text.
 */
function checkOneSource(
  spec: DashboardSpec,
  index: number,
  lookup: ConnectorLookup,
  timeRange: ResolvedTimeRange,
): SpecIssue[] {
  const variable = spec.variables[index];
  if (variable?.kind !== 'query') return [];
  const located = { query: variable.source, path: `variables[${index}].source` };
  const connector = boundOn(located, lookup);
  if (!connector) return [];
  const binds = (variables: Variables) =>
    checkBinding(located, connector, variables, timeRange).length === 0;
  const all = sampleVariables(spec);
  if (!binds(all)) return [];
  const path = `${located.path}.${queryTextKey(variable.source)}`;
  return spec.variables.slice(index).flatMap(({ name }) => {
    const { [name]: _without, ...others } = all;
    return binds(others) ? [] : [{ path, message: orderMessage(variable.name, name) }];
  });
}

/**
 * Checks every variable's source uses only the variables declared before it.
 *
 * @param spec - A spec that passed the schema.
 * @param lookup - Finds a connector by name.
 * @param timeRange - The default time range, resolved.
 * @returns The issues, at each source's text.
 */
export function checkSourceOrder(
  spec: DashboardSpec,
  lookup: ConnectorLookup,
  timeRange: ResolvedTimeRange,
): SpecIssue[] {
  return spec.variables.flatMap((_variable, index) =>
    checkOneSource(spec, index, lookup, timeRange),
  );
}
