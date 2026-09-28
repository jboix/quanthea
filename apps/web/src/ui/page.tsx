import type { ReactNode } from 'react';
import styles from './page.module.css';

/** Props of {@link Page}. */
interface PageProps {
  /** The page heading. */
  readonly title: string;
  /** One line under the heading. */
  readonly subtitle?: ReactNode;
  /** Controls on the right of the heading, such as "New thread". */
  readonly actions?: ReactNode;
  /** The page content. */
  readonly children?: ReactNode;
}

/**
 * The layout of a full-width screen such as Library or Settings: a large heading, a subtitle and
 * the content below.
 *
 * @param props - Heading, subtitle, actions and content.
 * @returns The page.
 */
export function Page({ title, subtitle, actions, children }: PageProps) {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.titles}>
          <h1 className={styles.title}>{title}</h1>
          {subtitle !== undefined && <p className={styles.subtitle}>{subtitle}</p>}
        </div>
        {actions}
      </header>
      {children}
    </div>
  );
}
