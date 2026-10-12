import type { ReactNode } from 'react';
import styles from './page.module.css';
import { TitleHeader } from './title-header.tsx';

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
      <TitleHeader
        level={1}
        size="page"
        align="start"
        title={title}
        below={subtitle !== undefined && <p className={styles.subtitle}>{subtitle}</p>}
        actions={actions}
      />
      {children}
    </div>
  );
}
