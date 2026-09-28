import { type InputHTMLAttributes, type ReactNode, useId } from 'react';
import styles from './field.module.css';

/** Props of {@link Input}. */
interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  /** The visible label. */
  readonly label: ReactNode;
  /** One line under the control. */
  readonly hint?: ReactNode;
  /** Sets the value in IBM Plex Mono, for URLs, keys, limits and identifiers. */
  readonly mono?: boolean;
}

/**
 * A labelled text input.
 *
 * @param props - Label, hint, font and any native input attribute.
 * @returns The field: label, input and optional hint.
 */
export function Input({ label, hint, mono = false, className, ...rest }: InputProps) {
  const inputId = useId();
  const classes = [styles.control, mono && styles.mono, className].filter(Boolean).join(' ');
  return (
    <div className={styles.field}>
      <label htmlFor={inputId} className={styles.label}>
        {label}
      </label>
      <input id={inputId} className={classes} {...rest} />
      {hint !== undefined && <span className={styles.hint}>{hint}</span>}
    </div>
  );
}
