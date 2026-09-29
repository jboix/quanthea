import { type ReactNode, type TextareaHTMLAttributes, useId } from 'react';
import styles from './field.module.css';
import { describedBy, FieldNotes } from './field-notes.tsx';

/** Props of {@link TextArea}. */
interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  /** The visible label. */
  readonly label: ReactNode;
  /** One line under the control. */
  readonly hint?: ReactNode;
  /** Sets the text in IBM Plex Mono, for queries and code. */
  readonly mono?: boolean;
  /** What is wrong with the value. It replaces the hint and marks the field invalid. */
  readonly error?: string | undefined;
}

/**
 * A labelled text area.
 *
 * @param props - Label, hint, error, font and any native text area attribute.
 * @returns The field: label, text area, and the error or hint.
 */
export function TextArea({ label, hint, mono = false, error, className, ...rest }: TextAreaProps) {
  const areaId = useId();
  const classes = [styles.control, styles.area, mono && styles.mono, className]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={styles.field}>
      <label htmlFor={areaId} className={styles.label}>
        {label}
      </label>
      <textarea
        id={areaId}
        className={classes}
        {...describedBy(`${areaId}-notes`, hint, error)}
        {...rest}
      />
      <FieldNotes id={`${areaId}-notes`} hint={hint} error={error} />
    </div>
  );
}
