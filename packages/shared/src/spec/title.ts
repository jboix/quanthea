/**
 * A panel title with the chosen value of each variable it names, such as `Most conflicting
 * $browser versions` drawn as `Most conflicting Firefox versions`. A title is stored unfilled,
 * since it also names its panel, and is filled only where it is shown.
 */
import { labelOfValue } from './variable-options.ts';
import { allValue, type Variable, type VariableValues } from './variables.ts';

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
 * A title with the values of the variables it names: the chosen value, else the default. A name
 * no variable has, and a variable with no value, stay as written.
 *
 * @param title - The title, as stored.
 * @param variables - The spec's variables.
 * @param values - The values chosen, by name.
 * @returns The title as shown.
 */
export function filledTitle(
  title: string,
  variables: readonly Variable[],
  values: VariableValues = {},
): string {
  if (!title.includes('$')) return title;
  return title.replace(reference, (written, braced?: string, bare?: string) => {
    const name = braced ?? bare ?? '';
    const variable = variables.find((each) => each.name === name);
    const value = values[name] ?? variable?.default;
    return variable === undefined || value === undefined ? written : valueText(variable, value);
  });
}
