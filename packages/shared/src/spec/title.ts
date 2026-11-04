/**
 * A panel title with the chosen value of each variable it names, such as `Most conflicting
 * $browser versions` drawn as `Most conflicting Firefox versions`. A title is stored unfilled,
 * since it also names its panel, and is filled only where it is shown.
 */
import { labelOfValue } from './variable-options.ts';
import { allValue, type Variable, type VariableValues, variableDefault } from './variables.ts';

/** `$name` or `${name}`, as a query writes a variable. */
const reference = /\$\{([a-z][a-z0-9_]*)\}|\$([a-z][a-z0-9_]*)/g;

/** How many values of a list a title names before it counts the rest. */
const namedValues = 3;

/**
 * A variable's value as a title shows it: its label, "All", or a short list.
 *
 * @param variable - The variable.
 * @param value - Its value, one or several.
 * @returns Such as `Firefox`, `All` or `Firefox, Safari, Chrome +2`.
 */
function valueText(variable: Variable, value: string | readonly string[]): string {
  const values = [value].flat();
  if (values.includes(allValue)) return 'All';
  const options = variable.kind === 'custom' ? variable.options : undefined;
  const labels = values.map((each) => labelOfValue(options, each));
  const rest = labels.length - namedValues;
  return rest > 0 ? `${labels.slice(0, namedValues).join(', ')} +${rest}` : labels.join(', ');
}

/**
 * The names of the computed variables a title names, whose values only the server reads.
 *
 * @param title - The title, as stored.
 * @param variables - The spec's variables.
 * @returns The names, each once.
 */
export function computedInTitle(title: string, variables: readonly Variable[]): string[] {
  const computed = new Set(
    variables.filter((each) => each.kind === 'computed').map((variable) => variable.name),
  );
  const named = [...title.matchAll(reference)].map((match) => match[1] ?? match[2] ?? '');
  return [...new Set(named.filter((name) => computed.has(name)))];
}

/**
 * A title with the values of the variables it names: the chosen value, else the default. A
 * computed variable shows the value the server read, and `…` until there is one. A name no
 * variable has, and any other variable with no value, stay as written.
 *
 * @param title - The title, as stored.
 * @param variables - The spec's variables.
 * @param values - The values chosen, and those of computed variables, by name.
 * @returns The title as shown.
 */
export function filledTitle(
  title: string,
  variables: readonly Variable[],
  values: VariableValues = {},
): string {
  if (!title.includes('$')) return title;
  return title.replace(reference, (written, braced?: string, bare?: string) =>
    referenceText(
      written,
      variables.find((each) => each.name === (braced ?? bare)),
      values,
    ),
  );
}

/**
 * What one reference in a title shows.
 *
 * @param written - The reference as the title writes it.
 * @param variable - The variable it names, if the spec has one.
 * @param values - The values chosen, and those of computed variables, by name.
 * @returns The value's text, `…` for a computed variable not read yet, else the reference.
 */
function referenceText(
  written: string,
  variable: Variable | undefined,
  values: VariableValues,
): string {
  if (variable === undefined) return written;
  const value = values[variable.name] ?? variableDefault(variable);
  if (value !== undefined) return valueText(variable, value);
  return variable.kind === 'computed' ? '…' : written;
}
