import { type ReactNode, type SelectHTMLAttributes, useId } from 'react';
import styles from './field.module.css';
import { describedBy, FieldNotes } from './field-notes.tsx';

/** One choice of a {@link Select}. */
interface SelectOption {
  /** The submitted value. */
  readonly value: string;
  /** The visible text. */
  readonly label: string;
}

/** Props of {@link Select}. */
interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'children'> {
  /** The visible label. */
  readonly label: ReactNode;
  /** The choices, in order. */
  readonly options: readonly SelectOption[];
  /** Sets the options in IBM Plex Mono, for model names and identifiers. */
  readonly mono?: boolean;
  /** One line under the control. */
  readonly hint?: ReactNode;
  /** What is wrong with the value. It replaces the hint. */
  readonly error?: string | undefined;
}

/**
 * A labelled native select.
 *
 * @param props - Label, options, font, hint, error and any native select attribute.
 * @returns The field: label, select, and the error or hint.
 */
export function Select({
  label,
  options,
  mono = false,
  hint,
  error,
  className,
  ...rest
}: SelectProps) {
  const selectId = useId();
  const classes = [styles.control, mono && styles.mono, className].filter(Boolean).join(' ');
  return (
    <div className={styles.field}>
      <label htmlFor={selectId} className={styles.label}>
        {label}
      </label>
      <select
        id={selectId}
        className={classes}
        {...describedBy(`${selectId}-notes`, hint, error)}
        {...rest}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <FieldNotes id={`${selectId}-notes`} hint={hint} error={error} />
    </div>
  );
}
