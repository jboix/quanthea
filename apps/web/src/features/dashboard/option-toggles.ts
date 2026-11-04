/**
 * When a variable's options show as toggles in the bar, one for each option, instead of a menu,
 * and what a toggle chooses.
 */
import {
  allValue,
  type ChosenVariable,
  labelOfValue,
  optionValues,
  type VariableOption,
} from '@quanthea/shared';

/** The most options a variable shows as toggles. */
const mostToggles = 8;

/** The longest label a toggle shows, in characters. */
const longestLabel = 16;

/**
 * The options of a variable that shows as toggles: a custom one that holds several values and has
 * a few short options.
 *
 * @param variable - The variable.
 * @returns Its options, or `undefined` when it shows as a menu.
 */
export function toggleOptions(variable: ChosenVariable): readonly VariableOption[] | undefined {
  if (variable.kind !== 'custom' || !variable.multi) return undefined;
  const { options } = variable;
  if (options.length < 2 || options.length > mostToggles) return undefined;
  const short = optionValues(options).every(
    (value) => labelOfValue(options, value).length <= longestLabel,
  );
  return short ? options : undefined;
}

/**
 * The values chosen, every option for "All".
 *
 * @param options - The variable's options.
 * @param value - The value chosen.
 * @returns The values, in the options' order.
 */
export function chosenValues(
  options: readonly VariableOption[],
  value: string | readonly string[],
): string[] {
  const values = [value].flat();
  const all = optionValues(options);
  return values.includes(allValue) ? all : all.filter((each) => values.includes(each));
}

/**
 * The values after a toggle: the option added, or taken out unless it is the last one chosen.
 *
 * @param options - The variable's options.
 * @param value - The value chosen.
 * @param toggled - The option toggled.
 * @returns The values, in the options' order.
 */
export function afterToggle(
  options: readonly VariableOption[],
  value: string | readonly string[],
  toggled: string,
): string[] {
  const chosen = chosenValues(options, value);
  if (!chosen.includes(toggled)) return chosenValues(options, [...chosen, toggled]);
  return chosen.length === 1 ? chosen : chosen.filter((each) => each !== toggled);
}
