/**
 * Turns a viewer's variable choices into bindings for the query engine, checked against the spec's
 * declarations. Values are bound, never pasted into a query. A value a viewer picks is still one of
 * the variable's options, a query-backed one too, so a viewer reads only what the dashboard lists:
 * a Valkey key or an HTTP path segment names data, and binding alone does not bound it. "All"
 * expands to the options.
 */
import {
  allValue,
  type ChosenVariable,
  type DashboardSpec,
  isMultiValue,
  maxTextValueLength,
  offersAll,
  optionValues,
  type Variable,
  type VariableValues,
} from '@quanthea/shared';
import { AppError } from '../lib/errors.ts';
import type { VariableBinding, Variables } from '../query/variables.ts';
import type { ComputedVariable } from './computed.ts';
import { slowPattern } from './safe-pattern.ts';

/** A query-backed variable. */
export type QueryVariable = Extract<Variable, { kind: 'query' }>;

/**
 * Lists the options of a query-backed variable, or the values of a computed one, bound with the
 * variables resolved before it.
 */
export type OptionsLoader = (
  variable: QueryVariable | ComputedVariable,
  resolved: Variables,
) => Promise<string[]>;

/**
 * Refuses a choice.
 *
 * @param variable - The variable.
 * @param message - What is wrong.
 * @returns Never.
 * @throws {AppError} `bad_request`.
 */
function refuse(variable: ChosenVariable, message: string): never {
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
  variable: ChosenVariable,
  picked?: string | readonly string[] | undefined,
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
function bindingOf(variable: ChosenVariable, values: readonly string[]): VariableBinding {
  const multi = isMultiValue(variable);
  if (values.length === 0) refuse(variable, 'needs a value.');
  if (!multi && values.length > 1) refuse(variable, 'takes one value.');
  return { value: multi ? values : (values[0] ?? '') };
}

/**
 * Binds a text variable, checking a picked value's length and the value against the pattern. The
 * default is bound as it is: validation matched it against the pattern when the version was saved.
 * A pattern that could backtrack for long is never run: validation refuses it in a new version,
 * and an older version's refuses every other value.
 *
 * @param variable - The variable.
 * @param picked - The viewer's choice, if any.
 * @returns The binding.
 * @throws {AppError} `bad_request` for a value too long, a slow pattern, or a value that does not
 *   match.
 */
function textBinding(
  variable: Extract<Variable, { kind: 'text' }>,
  picked: string | readonly string[] | undefined,
): VariableBinding {
  const binding = bindingOf(variable, chosenValues(variable, picked));
  const value = String(binding.value);
  if (picked !== undefined && value.length > maxTextValueLength)
    refuse(variable, `is at most ${maxTextValueLength} characters.`);
  if (variable.pattern === undefined || value === variable.default) return binding;
  if (slowPattern(variable.pattern))
    refuse(variable, 'has a pattern that cannot be checked safely.');
  if (!new RegExp(`^(?:${variable.pattern})$`).test(value))
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
  const options = optionValues(variable.options);
  if (values.includes(allValue)) {
    if (!offersAll(variable)) refuse(variable, 'has no "All" choice.');
    return { value: options };
  }
  // A label is shown, never bound: a viewer's choice is checked against the values.
  const unknown = values.find((value) => !options.includes(value));
  if (unknown !== undefined) refuse(variable, `has no option "${unknown}".`);
  const binding = bindingOf(variable, values);
  return variable.kind === 'interval' ? { ...binding, duration: true } : binding;
}

/**
 * Binds the values a viewer picked for a query-backed variable when each is one of its options or
 * its default. A value no longer offered, such as one the variables before it no longer list,
 * gives the default instead.
 *
 * @param variable - The variable.
 * @param values - The picked values.
 * @param resolved - The variables resolved before it.
 * @param loadOptions - Lists its options.
 * @returns The binding.
 */
async function pickedBinding(
  variable: QueryVariable,
  values: readonly string[],
  resolved: Variables,
  loadOptions: OptionsLoader,
): Promise<VariableBinding> {
  const allowed = new Set([...(await loadOptions(variable, resolved)), ...chosenValues(variable)]);
  const offered = values.every((value) => allowed.has(value));
  if (!offered) return queryBinding(variable, undefined, resolved, loadOptions);
  return bindingOf(variable, values);
}

/**
 * Binds a query-backed variable. A picked value must be an option or the default, or the default
 * is bound. "All", or no choice and no default, loads the options.
 *
 * @param variable - The variable.
 * @param picked - The viewer's choice, if any.
 * @param resolved - The variables resolved before it.
 * @param loadOptions - Lists its options.
 * @returns The binding.
 */
async function queryBinding(
  variable: QueryVariable,
  picked: string | readonly string[] | undefined,
  resolved: Variables,
  loadOptions: OptionsLoader,
): Promise<VariableBinding> {
  const values = chosenValues(variable, picked);
  const all = values.includes(allValue);
  if (all && !offersAll(variable)) refuse(variable, 'has no "All" choice.');
  if (all) return { value: await loadOptions(variable, resolved) };
  if (values.length === 0) return firstOption(variable, resolved, loadOptions);
  if (picked === undefined) return bindingOf(variable, values);
  return pickedBinding(variable, values, resolved, loadOptions);
}

/**
 * Binds a query-backed variable with neither a choice nor a default to its first option.
 *
 * @param variable - The variable.
 * @param resolved - The variables resolved before it.
 * @param loadOptions - Lists its options.
 * @returns The binding.
 * @throws {AppError} `bad_request` when it has no options.
 */
async function firstOption(
  variable: QueryVariable,
  resolved: Variables,
  loadOptions: OptionsLoader,
): Promise<VariableBinding> {
  const options = await loadOptions(variable, resolved);
  if (options.length === 0) refuse(variable, 'has no options.');
  return { value: variable.multi ? options.slice(0, 1) : (options[0] ?? '') };
}

/**
 * Binds one chosen variable.
 *
 * @param variable - The variable.
 * @param choice - The viewer's choice, if any.
 * @param resolved - The variables resolved before it.
 * @param loadOptions - Lists the options of a query-backed variable.
 * @returns The binding.
 */
function chosenBinding(
  variable: ChosenVariable,
  choice: string | readonly string[] | undefined,
  resolved: Variables,
  loadOptions: OptionsLoader,
): VariableBinding | Promise<VariableBinding> {
  if (variable.kind === 'text') return textBinding(variable, choice);
  if (variable.kind === 'query') return queryBinding(variable, choice, resolved, loadOptions);
  return listedBinding(variable, chosenValues(variable, choice));
}

/**
 * Binds a computed variable to what its source returns, whatever was picked: one value, or a list
 * when it holds several.
 *
 * @param variable - The variable.
 * @param resolved - The variables resolved before it.
 * @param loadValues - Computes its values.
 * @returns The binding.
 */
async function computedBinding(
  variable: ComputedVariable,
  resolved: Variables,
  loadValues: OptionsLoader,
): Promise<VariableBinding> {
  const values = await loadValues(variable, resolved);
  return { value: variable.multi ? values : (values[0] ?? '') };
}

/**
 * Resolves every variable of a spec, in declaration order, so a query-backed or computed variable
 * may use the ones before it. Choices for undeclared names, and for computed variables, are
 * ignored.
 *
 * @param spec - The spec.
 * @param picked - The viewer's choices.
 * @param loadOptions - Lists the options of a query-backed variable, or computes a computed one.
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
    resolved[variable.name] =
      variable.kind === 'computed'
        ? await computedBinding(variable, resolved, loadOptions)
        : await chosenBinding(variable, picked[variable.name], resolved, loadOptions);
  }
  return resolved;
}
