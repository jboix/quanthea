import styles from './progress-line.module.css';

/** Props of {@link ProgressLine}. */
interface ProgressLineProps {
  /** How far along, from 0 to 1; a moving line when unknown. */
  readonly value?: number;
  /** What is loading, for screen readers. Without it the line is decoration. */
  readonly label?: string;
}

/**
 * A thin line that shows something is loading: how far along when that is known, else a moving
 * segment. It stands still under reduced motion.
 *
 * @param props - How far along, and what loads.
 * @returns The line.
 */
export function ProgressLine({ value, label }: ProgressLineProps) {
  const known = value !== undefined;
  const fill = known ? { width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` } : {};
  const named = label
    ? { role: 'progressbar', 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': 100 }
    : { 'aria-hidden': true };
  const now = label && known ? { 'aria-valuenow': Math.round(value * 100) } : {};
  return (
    <span className={styles.line} {...named} {...now}>
      <span className={styles.fill} data-known={known} style={fill} />
    </span>
  );
}
