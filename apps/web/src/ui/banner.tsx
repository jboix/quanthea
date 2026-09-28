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
}

/**
 * A full-width strip at the top of the page for a persistent condition, such as open access.
 *
 * @param props - Tone, icon and message.
 * @returns The banner, announced to screen readers as a status.
 */
export function Banner({ tone = 'warning', icon, children }: BannerProps) {
  return (
    <div role="status" className={`${styles.banner} ${styles[tone]}`}>
      {icon}
      <span>{children}</span>
    </div>
  );
}
