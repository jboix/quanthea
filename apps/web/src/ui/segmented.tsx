import { type ReactNode, useId } from 'react';
import styles from './segmented.module.css';

/** One choice of a {@link Segmented} control. */
interface SegmentedOption<Value extends string> {
  /** The value it stands for. */
  readonly value: Value;
  /** The label. */
  readonly label: string;
  /** An icon before the label. */
  readonly icon?: ReactNode;
}

/** Props of {@link Segmented}. */
interface SegmentedProps<Value extends string> {
  /** The accessible name of the group. */
  readonly label: string;
  /** The choices, in order. */
  readonly options: readonly SegmentedOption<Value>[];
  /** The chosen value. */
  readonly value: Value;
  /** Called with the value the user picks. */
  readonly onChange: (value: Value) => void;
}

/**
 * A switch between a few choices, side by side in one pill, the chosen one filled. It is a group
 * of native radio buttons, so arrow keys move the choice.
 *
 * @param props - The label, the choices, the value and the change callback.
 * @returns The group.
 */
export function Segmented<Value extends string>({
  label,
  options,
  value,
  onChange,
}: SegmentedProps<Value>) {
  const name = useId();
  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>{label}</legend>
      {options.map((option) => (
        <label key={option.value} className={styles.option}>
          <input
            type="radio"
            className={styles.input}
            name={name}
            value={option.value}
            checked={option.value === value}
            onChange={() => onChange(option.value)}
          />
          {option.icon}
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}
