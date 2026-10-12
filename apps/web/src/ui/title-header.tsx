import type { ReactNode } from 'react';
import styles from './title-header.module.css';

/** How large the title is: a page, a screen, a pane, a section, a card, or a compact bar. */
type TitleHeaderSize = 'page' | 'screen' | 'pane' | 'section' | 'card' | 'compact';

/** Props of {@link TitleHeader}. */
interface TitleHeaderProps {
  /** The title's full text: shown, cut with an ellipsis when it does not fit, and its tooltip. */
  readonly title: string;
  /** What the heading shows instead of the plain text, such as a link with the same words. */
  readonly titleContent?: ReactNode;
  /** The heading's level. */
  readonly level?: 1 | 2 | 3;
  /** The id of the heading, for `aria-labelledby`. */
  readonly titleId?: string;
  /** The title's size. */
  readonly size?: TitleHeaderSize;
  /** Sets the title in the monospaced font, for identifiers such as a connector's name. */
  readonly mono?: boolean;
  /** Wraps the title onto more lines instead of cutting it, where the title is the content. */
  readonly wrap?: boolean;
  /** One line above the title, such as a breadcrumb. */
  readonly eyebrow?: ReactNode;
  /** What stands before the title and stays with it, such as an icon. */
  readonly before?: ReactNode;
  /** What stands after the title and stays with it, such as a next arrow. */
  readonly after?: ReactNode;
  /** Pills after the title. They keep their size and move below the title as a group. */
  readonly badges?: ReactNode;
  /** Lines under the title. They wrap. */
  readonly below?: ReactNode;
  /** Controls at the end. They stay on one line and move below the title as a group. */
  readonly actions?: ReactNode;
  /** How the actions sit beside the text: at its top, its middle or its bottom. */
  readonly align?: 'start' | 'center' | 'end';
  /** The element drawn: a `header`, or a `div` inside another header or a section. */
  readonly as?: 'header' | 'div';
  /** The caller's class, for the padding, border and background around the header. */
  readonly className?: string | undefined;
}

/**
 * The title with what stays beside it, then the badges.
 *
 * @param props - The header's props.
 * @returns The row.
 */
function TitleRow(props: TitleHeaderProps) {
  const { title, titleContent, level = 2, titleId, before, after, badges } = props;
  const Heading = `h${level}` as const;
  return (
    <div className={styles.titleRow}>
      <div className={styles.name}>
        {before}
        <Heading id={titleId} className={styles.title} title={title}>
          {titleContent ?? title}
        </Heading>
        {after}
      </div>
      {hasContent(badges) && <div className={styles.badges}>{badges}</div>}
    </div>
  );
}

/**
 * Whether a slot holds something to draw, so an empty slot adds no gap.
 *
 * @param slot - The slot's content.
 * @returns Whether to draw it.
 */
function hasContent(slot: ReactNode): boolean {
  return slot !== undefined && slot !== null && slot !== false;
}

/**
 * The header of a page, a pane, a card or a dialog. The title ends in an ellipsis when it does
 * not fit and keeps its full text as a tooltip, or wraps when asked to. Badges and actions keep
 * their size, and move below the title as a group when there is no room beside it, never over it.
 *
 * @param props - The title, what surrounds it, and the actions.
 * @returns The header.
 */
export function TitleHeader(props: TitleHeaderProps) {
  const { eyebrow, below, actions, size = 'pane', align = 'center', className } = props;
  const Element = props.as ?? 'header';
  return (
    <Element
      className={className === undefined ? styles.header : `${styles.header} ${className}`}
      data-size={size}
      data-align={align}
      data-mono={props.mono === true}
      data-wrap={props.wrap === true}
    >
      <div className={styles.text}>
        {hasContent(eyebrow) && <div className={styles.eyebrow}>{eyebrow}</div>}
        <TitleRow {...props} />
        {hasContent(below) && <div className={styles.below}>{below}</div>}
      </div>
      {hasContent(actions) && <div className={styles.actions}>{actions}</div>}
    </Element>
  );
}
