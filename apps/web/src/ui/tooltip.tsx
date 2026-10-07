import { type ReactNode, useId } from 'react';
import styles from './tooltip.module.css';

/** Props of {@link Tooltip}. */
interface TooltipProps {
  /** What the tooltip says. */
  readonly text: string;
  /**
   * Where it shows: under the control after a short pause, or beside it at once, as in the
   * navigation rail.
   */
  readonly side?: 'below' | 'right';
  /**
   * Whether the control already carries the same words as its accessible name, such as an icon
   * link's `aria-label`. The note is then hidden from screen readers, so they do not say it twice.
   */
  readonly namesControl?: boolean;
  /** The control, given the id it must name in `aria-describedby`. */
  readonly children: (describedBy: string) => ReactNode;
}

/**
 * A short note by a control, shown while the control is hovered or focused. The control names it
 * in `aria-describedby`, so screen readers read it too, unless the note only repeats its name.
 *
 * @param props - The text, where it shows, whether it repeats the name, and the control.
 * @returns The control with its note.
 */
export function Tooltip({ text, side = 'below', namesControl = false, children }: TooltipProps) {
  const id = useId();
  return (
    <span className={styles.anchor}>
      {children(id)}
      <span
        id={id}
        role={namesControl ? undefined : 'tooltip'}
        aria-hidden={namesControl ? true : undefined}
        className={styles.tip}
        data-side={side}
      >
        {text}
      </span>
    </span>
  );
}
