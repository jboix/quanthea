import { type InputHTMLAttributes, type ReactNode, type Ref, useId } from 'react';
import styles from './field.module.css';
import { describedBy, FieldNotes } from './field-notes.tsx';

/** Props of {@link Input}. */
interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  /** The visible label. */
  readonly label: ReactNode;
  /** One line under the control. */
  readonly hint?: ReactNode;
  /** Sets the value in IBM Plex Mono, for URLs, keys, limits and identifiers. */
  readonly mono?: boolean;
  /** Keeps the label for screen readers only, for inputs whose purpose the layout shows. */
  readonly hideLabel?: boolean;
  /** What is wrong with the value. It replaces the hint and marks the input invalid. */
  readonly error?: string | undefined;
  /** The input element, for focusing it. */
  readonly ref?: Ref<HTMLInputElement>;
}

/**
 * A labelled text input.
 *
 * @param props - Label, hint, error, font, label visibility and any native input attribute.
 * @returns The field: label, input, and the error or hint.
 */
export function Input({
  label,
  hint,
  mono = false,
  hideLabel = false,
  error,
  className,
  ...rest
}: InputProps) {
  const inputId = useId();
  const classes = [styles.control, mono && styles.mono, className].filter(Boolean).join(' ');
  return (
    <div className={styles.field}>
      <label htmlFor={inputId} className={hideLabel ? styles.visuallyHidden : styles.label}>
        {label}
      </label>
      <input
        id={inputId}
        className={classes}
        {...describedBy(`${inputId}-notes`, hint, error)}
        {...rest}
      />
      <FieldNotes id={`${inputId}-notes`} hint={hint} error={error} />
    </div>
  );
}
