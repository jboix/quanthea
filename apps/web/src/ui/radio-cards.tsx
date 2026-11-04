import { type CSSProperties, type ReactNode, useId } from 'react';
import styles from './radio-cards.module.css';

/** One choice of a {@link RadioCards} group. */
interface RadioCardOption<Value extends string | number> {
  /** The value it stands for. */
  readonly value: Value;
  /** The title. */
  readonly title: string;
  /** A short tag after the title, such as `default`. */
  readonly tag?: string;
  /** A few words under the title: what it means, not how it works. */
  readonly description: ReactNode;
  /** An icon before the title. */
  readonly icon?: ReactNode;
}

/** Props of {@link RadioCards}. */
interface RadioCardsProps<Value extends string | number> {
  /** The accessible name of the group. */
  readonly label: string;
  /** The choices, in order. */
  readonly options: readonly RadioCardOption<Value>[];
  /** The chosen value. */
  readonly value: Value;
  /** Called with the value the user picks. */
  readonly onChange: (value: Value) => void;
  /** Shows the choice without letting the user change it. */
  readonly disabled?: boolean;
  /** How many cards sit in a row; two by default. */
  readonly columns?: number;
}

/**
 * A group of native radio buttons drawn as small cards, each with a title, a few words under it and
 * an optional icon, the chosen one in the accent colour.
 *
 * @param props - Label, options, value and change callback.
 * @returns The radio group.
 */
export function RadioCards<Value extends string | number>({
  label,
  options,
  value,
  onChange,
  disabled = false,
  columns = 2,
}: RadioCardsProps<Value>) {
  const name = useId();
  return (
    <fieldset
      className={styles.group}
      disabled={disabled}
      style={{ '--columns': columns } as CSSProperties}
    >
      <legend className={styles.legend}>{label}</legend>
      {options.map((option) => (
        <label key={option.value} className={styles.card}>
          <input
            type="radio"
            name={name}
            className={styles.input}
            checked={option.value === value}
            onChange={() => onChange(option.value)}
          />
          {option.icon !== undefined && (
            <span className={styles.icon} aria-hidden="true">
              {option.icon}
            </span>
          )}
          <span className={styles.text}>
            <span className={styles.title}>
              {option.title}
              {option.tag !== undefined && <span className={styles.tag}>{option.tag}</span>}
            </span>
            <span className={styles.description}>{option.description}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
