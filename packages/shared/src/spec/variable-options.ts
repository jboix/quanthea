/**
 * The options of a fixed-list variable: a value, or a value with a label a viewer reads, such as
 * `Only SwissTXT` for `true`. The value is what is checked and bound; the label is only shown.
 */
import { z } from 'zod';

/** Validates one variable value. */
export const variableValueSchema = z.string().max(200);

/** Validates an option: a value, or a value with its label. */
export const variableOptionSchema = z.union([
  variableValueSchema,
  z.strictObject({ value: variableValueSchema, label: z.string().min(1).max(100) }),
]);

/** An option of a fixed-list variable. */
export type VariableOption = z.infer<typeof variableOptionSchema>;

/**
 * The value of an option, which is checked and bound.
 *
 * @param option - The option.
 * @returns Its value.
 */
export function optionValue(option: VariableOption): string {
  return typeof option === 'string' ? option : option.value;
}

/**
 * What a viewer reads for an option.
 *
 * @param option - The option.
 * @returns Its label, or its value when it has none.
 */
export function optionLabel(option: VariableOption): string {
  return typeof option === 'string' ? option : option.label;
}

/**
 * The values of a list of options, in order.
 *
 * @param options - The options.
 * @returns Their values.
 */
export function optionValues(options: readonly VariableOption[]): string[] {
  return options.map(optionValue);
}

/**
 * What a viewer reads for a value: the label of the option that holds it, else the value.
 *
 * @param options - The variable's options; none for a variable that lists none.
 * @param value - The value.
 * @returns The label, or the value.
 */
export function labelOfValue(
  options: readonly VariableOption[] | undefined,
  value: string,
): string {
  const option = options?.find((each) => optionValue(each) === value);
  return option === undefined ? value : optionLabel(option);
}
