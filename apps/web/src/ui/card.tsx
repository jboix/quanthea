import { type ReactNode, useId } from 'react';
import styles from './card.module.css';
import { TitleHeader } from './title-header.tsx';

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
  const className = variant === 'dashed' ? `${styles.card} ${styles.dashed}` : styles.card;
  return (
    <section className={className} aria-labelledby={title === undefined ? undefined : titleId}>
      {title === undefined ? (
        actions !== undefined && <div className={styles.actions}>{actions}</div>
      ) : (
        <TitleHeader
          as="div"
          size="compact"
          align="start"
          wrap
          title={title}
          titleId={titleId}
          below={description !== undefined && <p className={styles.description}>{description}</p>}
          actions={actions}
        />
      )}
      {children}
    </section>
  );
}
