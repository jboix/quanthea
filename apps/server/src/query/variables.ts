/** The variable values a query is bound with. */

/** One variable's value for this run. */
export interface VariableBinding {
  /** One value, or several for a multi-value variable. */
  readonly value: string | readonly string[];
  /** For PromQL: the value is a regular expression, so it is not escaped in `=~` matchers. */
  readonly regex?: boolean;
}

/** The variables of a run, by name (without `$` or `:`). */
export type Variables = Readonly<Record<string, VariableBinding>>;

/**
 * The values of a binding as a list.
 *
 * @param binding - The binding.
 * @returns Its values.
 */
export function valuesOf(binding: VariableBinding): readonly string[] {
  return typeof binding.value === 'string' ? [binding.value] : binding.value;
}
