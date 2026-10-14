import { ProgressLine } from '../../ui/progress-line.tsx';
import styles from './dashboard.module.css';

/** Props of {@link LoadProgress}. */
interface LoadProgressProps {
  /** How many panels finished their run. */
  readonly done: number;
  /** How many panels run. */
  readonly total: number;
}

/**
 * How many of the dashboard's panels have loaded, while some still run, such as
 * "4 of 12 panels loaded" over a line that fills.
 *
 * @param props - The panels done, of how many.
 * @returns The progress, or nothing once every panel loaded.
 */
export function LoadProgress({ done, total }: LoadProgressProps) {
  if (total === 0 || done >= total) return null;
  const text = `${done} of ${total} ${total === 1 ? 'panel' : 'panels'} loaded`;
  return (
    <span className={styles.loadProgress} role="status">
      <span className={styles.loadText}>{text}</span>
      <ProgressLine value={done / total} />
    </span>
  );
}
