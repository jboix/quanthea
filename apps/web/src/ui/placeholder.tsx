import type { ReactNode } from 'react';
import styles from './placeholder.module.css';

/** Props of {@link Placeholder}. */
interface PlaceholderProps {
  /** What will be here. */
  readonly title: string;
  /** More detail, such as the screen it will implement. */
  readonly children?: ReactNode;
}

/**
 * A dashed box standing in for a screen or a panel that is not built yet.
 *
 * @param props - Title and detail.
 * @returns The placeholder.
 */
export function Placeholder({ title, children }: PlaceholderProps) {
  return (
    <div className={styles.placeholder}>
      <h2 className={styles.title}>{title}</h2>
      {children !== undefined && <p className={styles.body}>{children}</p>}
    </div>
  );
}
