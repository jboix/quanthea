import type { ReactNode } from 'react';
import styles from './empty-state.module.css';

/** Props of {@link EmptyState}. */
interface EmptyStateProps {
  /** The icon in the mark above the title. */
  readonly icon: ReactNode;
  /** What is missing, in a few words. */
  readonly title: string;
  /** One sentence on how it fills, or why nothing shows. */
  readonly children?: ReactNode;
  /** A way out, such as a link to add the first one. */
  readonly action?: ReactNode;
  /** Whether it fills its pane and sits in the middle, or sits in a list's place. */
  readonly fill?: boolean;
  /** Whether it stands for a whole page, such as an address with nothing at it: larger. */
  readonly page?: boolean;
}

/**
 * What a screen or a list shows when it has nothing: a quiet mark, a title, a sentence and an
 * optional action, centred. Every empty screen uses it, so they read alike.
 *
 * @param props - The icon, the title, the sentence, the action, and whether it fills its pane or
 *   stands for a page.
 * @returns The empty state.
 */
export function EmptyState(props: EmptyStateProps) {
  const { icon, title, children, action, fill = false, page = false } = props;
  return (
    <div className={styles.empty} data-fill={fill || page} data-page={page}>
      <div className={styles.mark} aria-hidden="true">
        {icon}
      </div>
      <h2 className={styles.title}>{title}</h2>
      {children !== undefined && <p className={styles.text}>{children}</p>}
      {action !== undefined && <div className={styles.actions}>{action}</div>}
    </div>
  );
}
