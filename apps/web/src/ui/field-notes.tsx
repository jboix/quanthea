import type { ReactNode } from 'react';
import styles from './field.module.css';

/** Props of {@link FieldNotes}. */
interface FieldNotesProps {
  /** The id of the notes, for the control's `aria-describedby`. */
  readonly id: string;
  /** One line of help. */
  readonly hint?: ReactNode;
  /** What is wrong with the value, if anything. */
  readonly error?: string | undefined;
}

/**
 * The lines under a form control: the error when there is one, else the hint.
 *
 * @param props - The id, hint and error.
 * @returns The line, or nothing.
 */
export function FieldNotes({ id, hint, error }: FieldNotesProps) {
  if (error !== undefined) {
    return (
      <span id={id} className={styles.error}>
        {error}
      </span>
    );
  }
  if (hint === undefined) return null;
  return (
    <span id={id} className={styles.hint}>
      {hint}
    </span>
  );
}

/**
 * The accessibility attributes that tie a control to its notes.
 *
 * @param id - The id of the notes.
 * @param hint - The hint, if any.
 * @param error - The error, if any.
 * @returns `aria-describedby` and `aria-invalid`.
 */
export function describedBy(id: string, hint: ReactNode, error: string | undefined) {
  const hasNotes = hint !== undefined || error !== undefined;
  return {
    'aria-describedby': hasNotes ? id : undefined,
    'aria-invalid': error !== undefined ? true : undefined,
  };
}
