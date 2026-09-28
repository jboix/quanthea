import type { ReactNode } from 'react';
import styles from './pill.module.css';

/** The colour of a pill: status colours from the visual language. */
type PillTone = 'neutral' | 'accent' | 'ok' | 'danger' | 'draft';

/** Props of {@link Pill}. */
interface PillProps {
  /** The colour. `draft` is amber, for drafts and changes. */
  readonly tone?: PillTone;
  /** `tag` is the small square label ("Pinned · v3"); `round` is the status pill ("v3 · draft"). */
  readonly shape?: 'round' | 'tag';
  /** Sets the text in IBM Plex Mono, for versions, identifiers and connector names. */
  readonly mono?: boolean;
  /** The label. */
  readonly children: ReactNode;
  /** Makes the pill removable: a × button with this accessible name calls it. */
  readonly onRemove?: () => void;
  /** The accessible name of the remove button. */
  readonly removeLabel?: string;
}

/**
 * A small label for a status, a version or a count.
 *
 * @param props - Tone, shape, font, label, and an optional remove action.
 * @returns The pill element.
 */
export function Pill({
  tone = 'neutral',
  shape = 'round',
  mono = false,
  children,
  onRemove,
  removeLabel,
}: PillProps) {
  const classes = [styles.pill, styles[tone], shape === 'tag' && styles.tag, mono && styles.mono];
  return (
    <span className={classes.filter(Boolean).join(' ')}>
      {children}
      {onRemove && (
        <button
          type="button"
          className={styles.remove}
          aria-label={removeLabel ?? 'Remove'}
          onClick={onRemove}
        >
          ×
        </button>
      )}
    </span>
  );
}
