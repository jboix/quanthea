import { type ReactNode, useId } from 'react';
import styles from './card.module.css';

/** Props of {@link Card}. */
interface CardProps {
  /** The heading, also the accessible name of the section. */
  readonly title?: string;
  /** One line under the heading. */
  readonly description?: ReactNode;
  /** Controls on the right of the heading. */
  readonly actions?: ReactNode;
  /** `dashed` is the outline used for placeholders and suggestions. */
  readonly variant?: 'solid' | 'dashed';
  /** The content. */
  readonly children?: ReactNode;
}

/**
 * A white panel with the standard border and radius, optionally headed.
 *
 * @param props - Heading, description, actions, outline and content.
 * @returns A `section` labelled by its heading when there is one.
 */
export function Card({ title, description, actions, variant = 'solid', children }: CardProps) {
  const titleId = useId();
  const hasHeader = title !== undefined || actions !== undefined;
  const className = variant === 'dashed' ? `${styles.card} ${styles.dashed}` : styles.card;
  return (
    <section className={className} aria-labelledby={title === undefined ? undefined : titleId}>
      {hasHeader && (
        <div className={styles.header}>
          <div className={styles.titles}>
            {title !== undefined && (
              <h2 id={titleId} className={styles.title}>
                {title}
              </h2>
            )}
            {description !== undefined && <p className={styles.description}>{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}
