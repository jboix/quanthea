import type { ReactNode } from 'react';
import styles from './banner.module.css';

/** Props of {@link Banner}. */
interface BannerProps {
  /** `warning` (amber) for conditions the user should not ignore. */
  readonly tone?: 'warning' | 'info';
  /** An icon before the text. */
  readonly icon?: ReactNode;
  /** The message. */
  readonly children: ReactNode;
  /** Makes the banner dismissable: a × button calls it. */
  readonly onDismiss?: () => void;
}

/**
 * A full-width strip at the top of the page for a persistent condition, such as open access.
 *
 * @param props - Tone, icon, message and an optional dismiss action.
 * @returns The banner, announced to screen readers as a status.
 */
export function Banner({ tone = 'warning', icon, children, onDismiss }: BannerProps) {
  return (
    <div role="status" className={`${styles.banner} ${styles[tone]}`}>
      {icon}
      <span className={styles.message}>{children}</span>
      {onDismiss && (
        <button type="button" className={styles.dismiss} aria-label="Dismiss" onClick={onDismiss}>
          ×
        </button>
      )}
    </div>
  );
}
