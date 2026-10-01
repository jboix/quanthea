/**
 * Turns a viewer's variable choices into bindings for the query engine, checked against the spec's
 * declarations. Values are bound, never pasted into a query, so a query-backed value is not
 * checked against its options; "All" expands to them.
 */
import {
  allValue,
  type DashboardSpec,
  isMultiValue,
  type Variable,
  type VariableValues,
} from '@quanthea/shared';
import { AppError } from '../lib/errors.ts';
import type { VariableBinding, Variables } from '../query/variables.ts';

/** A query-backed variable. */
export type QueryVariable = Extract<Variable, { kind: 'query' }>;

/** Lists the options of a query-backed variable, bound with the variables resolved before it. */
export type OptionsLoader = (variable: QueryVariable, resolved: Variables) => Promise<string[]>;

/**
 * Refuses a choice.
 *
 * @param variable - The variable.
 * @param message - What is wrong.
 * @returns Never.
 * @throws {AppError} `bad_request`.
 */
function refuse(variable: Variable, message: string): never {
  throw new AppError('bad_request', `$${variable.name} ${message}`);
}

/**
 * The chosen values, or the default.
 *
 * @param variable - The variable.
 * @param picked - The viewer's choice, if any.
 * @returns The values, possibly empty.
 */
function chosenValues(
  variable: Variable,
  picked: string | readonly string[] | undefined,
): string[] {
  const value = picked ?? variable.default;
  return value === undefined ? [] : [value].flat();
}

/**
 * The binding of one or several values, as the variable takes them.
 *
 * @param variable - The variable.
 * @param values - The values.
 * @returns The binding.
 * @throws {AppError} `bad_request` for no value, or several for a single-value variable.
 */
function bindingOf(variable: Variable, values: readonly string[]): VariableBinding {
  const multi = isMultiValue(variable);
  if (values.length === 0) refuse(variable, 'needs a value.');
  if (!multi && values.length > 1) refuse(variable, 'takes one value.');
  return { value: multi ? values : (values[0] ?? '') };
}

/**
 * Binds a text variable, checking its pattern.
 *
 * @param variable - The variable.
 * @param values - The chosen values.
 * @returns The binding.
 */
function textBinding(variable: Extract<Variable, { kind: 'text' }>, values: readonly string[]) {
  const binding = bindingOf(variable, values);
  const pattern =
    variable.pattern === undefined ? undefined : new RegExp(`^(?:${variable.pattern})$`);
  if (pattern && !pattern.test(String(binding.value)))
    refuse(variable, 'does not match its pattern.');
  return binding;
}

/**
 * Binds a variable whose options the spec lists, checking every value is an option. An interval
 * variable's value is marked as a duration, the only kind PromQL takes where a duration goes.
 *
 * @param variable - The variable.
 * @param values - The chosen values.
 * @returns The binding.
 */
function listedBinding(
  variable: Extract<Variable, { kind: 'custom' | 'interval' }>,
  values: readonly string[],
): VariableBinding {
  const unknown = values.find((value) => !variable.options.includes(value));
  if (unknown !== undefined) refuse(variable, `has no option "${unknown}".`);
  const binding = bindingOf(variable, values);
  return variable.kind === 'interval' ? { ...binding, duration: true } : binding;
}

/**
 * Binds a query-backed variable. "All", or no choice and no default, loads the options.
 *
 * @param variable - The variable.
 * @param values - The chosen values.
 * @param resolved - The variables resolved before it.
 * @param loadOptions - Lists its options.
 * @returns The binding.
 */
async function queryBinding(
  variable: QueryVariable,
  values: readonly string[],
  resolved: Variables,
  loadOptions: OptionsLoader,
): Promise<VariableBinding> {
  const all = values.includes(allValue);
  if (all && !variable.includeAll) refuse(variable, 'has no "All" choice.');
  if (!all && values.length > 0) return bindingOf(variable, values);
  const options = await loadOptions(variable, resolved);
  if (all) return { value: options };
  if (options.length === 0) refuse(variable, 'has no options.');
  return { value: variable.multi ? options.slice(0, 1) : (options[0] ?? '') };
}

/**
 * Resolves every variable of a spec, in declaration order, so a query-backed variable may use the
 * ones before it. Choices for undeclared names are ignored.
 *
 * @param spec - The spec.
 * @param picked - The viewer's choices.
 * @param loadOptions - Lists the options of a query-backed variable.
 * @param until - Stop before this variable, when resolving the ones a variable's source uses.
 * @returns The bindings.
 * @throws {AppError} `bad_request` for a choice the declaration refuses.
 */
export async function resolveVariables(
  spec: DashboardSpec,
  picked: VariableValues,
  loadOptions: OptionsLoader,
  until?: string,
): Promise<Variables> {
  const resolved: Record<string, VariableBinding> = {};
  for (const variable of spec.variables) {
    if (variable.name === until) break;
    const values = chosenValues(variable, picked[variable.name]);
    if (variable.kind === 'text') resolved[variable.name] = textBinding(variable, values);
    else if (variable.kind === 'query')
      resolved[variable.name] = await queryBinding(variable, values, resolved, loadOptions);
    else resolved[variable.name] = listedBinding(variable, values);
  }
  return resolved;
}
