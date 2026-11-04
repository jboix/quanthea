/**
 * A variable as a row of toggles, one for each option, for a variable of a few short options that
 * holds several values: what is chosen shows at a glance and changes in one click.
 */
import {
  type ChosenVariable,
  labelOfValue,
  optionValues,
  type VariableOption,
} from '@quanthea/shared';
import styles from './option-toggle-chips.module.css';
import { afterToggle, chosenValues } from './option-toggles.ts';
import { VariableName } from './variable-chip.tsx';

/** Props of {@link OptionToggleChips}. */
interface OptionToggleChipsProps {
  /** The variable. */
  readonly variable: ChosenVariable;
  /** Its options, as toggles. */
  readonly options: readonly VariableOption[];
  /** The value chosen. */
  readonly value: string | readonly string[];
  /** Called with the values after a toggle. */
  readonly onChange: (next: readonly string[]) => void;
}

/**
 * The toggles of a variable's options. The last option chosen stays chosen.
 *
 * @param props - The variable, its options, the value chosen and the change callback.
 * @returns The toggles.
 */
export function OptionToggleChips({ variable, options, value, onChange }: OptionToggleChipsProps) {
  const chosen = chosenValues(options, value);
  return (
    <fieldset className={styles.toggles}>
      <legend className={styles.name}>
        <VariableName variable={variable} />
      </legend>
      {optionValues(options).map((option) => (
        <button
          key={option}
          type="button"
          className={styles.toggle}
          aria-pressed={chosen.includes(option)}
          onClick={() => onChange(afterToggle(options, value, option))}
        >
          {labelOfValue(options, option)}
        </button>
      ))}
    </fieldset>
  );
}
