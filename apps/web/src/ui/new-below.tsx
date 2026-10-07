import { ChevronDownIcon } from './icons.tsx';
import styles from './new-below.module.css';

/** Props of {@link NewBelow}. */
interface NewBelowProps {
  /** How many new items arrived below, 0 when only the latest one grew, `null` for none. */
  readonly unseen: number | null;
  /** What one item is called, such as `message` or `answer`. */
  readonly noun: string;
  /** Goes to the end. */
  readonly onJump: () => void;
}

/**
 * The button at the foot of a conversation saying what arrived below while the person read
 * further up. Pressing it goes to the end.
 *
 * @param props - What is unseen, what an item is called, and the way to the end.
 * @returns The button, or nothing while nothing new is below.
 */
export function NewBelow({ unseen, noun, onJump }: NewBelowProps) {
  if (unseen === null) return null;
  const words = unseen === 0 ? 'More below' : `${unseen} new ${unseen === 1 ? noun : `${noun}s`}`;
  return (
    <button type="button" className={styles.newBelow} onClick={onJump}>
      <ChevronDownIcon />
      {words}
    </button>
  );
}
