import styles from './status-dot.module.css';

/** Props of {@link StatusDot}. */
interface StatusDotProps {
  /** `ok` green, `failed` red, `pending` amber, `unknown` grey. */
  readonly status: 'ok' | 'failed' | 'pending' | 'unknown';
  /** What the status means, for screen readers and as a tooltip. */
  readonly label: string;
}

/**
 * A small coloured dot for a status, such as a connector's connection or an alert's state.
 *
 * @param props - The status and its meaning.
 * @returns The dot, named for assistive technology.
 */
export function StatusDot({ status, label }: StatusDotProps) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`${styles.dot} ${styles[status]}`}
    />
  );
}
