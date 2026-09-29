import type { ReactNode } from 'react';
import styles from './popover.module.css';
import { useDismiss } from './use-dismiss.ts';

/** Props of {@link Popover}. */
interface PopoverProps {
  /** What the button says to screen readers, and the dialog's name. */
  readonly label: string;
  /** What the button shows: an icon, or text. */
  readonly trigger: ReactNode;
  /** Whether the button is a small round icon button, or a text button. */
  readonly shape?: 'icon' | 'button';
  /** Which edge of the button the popover lines up with. */
  readonly align?: 'start' | 'end';
  /** Where the card opens: below the button, or beside it, rising from its bottom edge. */
  readonly placement?: 'below' | 'side';
  /** A class for the button, in place of the shape's, such as a navigation rail link's. */
  readonly triggerClassName?: string;
  /** The content. */
  readonly children: ReactNode;
}

/**
 * A button that opens a small floating card of details, closed by a press outside or Escape.
 *
 * @param props - The label, the trigger, its shape and class, where it opens, and the content.
 * @returns The button and, when open, its card.
 */
export function Popover({
  label,
  trigger,
  shape = 'icon',
  align = 'start',
  placement = 'below',
  triggerClassName,
  children,
}: PopoverProps) {
  const popover = useDismiss<HTMLSpanElement>();
  return (
    <span ref={popover.container} className={styles.popover}>
      <button
        type="button"
        className={triggerClassName ?? (shape === 'icon' ? styles.icon : styles.button)}
        aria-label={shape === 'icon' ? label : undefined}
        aria-expanded={popover.open}
        aria-haspopup="dialog"
        onClick={popover.toggle}
      >
        {trigger}
      </button>
      {popover.open && (
        <div
          role="dialog"
          aria-label={label}
          className={styles.card}
          data-align={align}
          data-placement={placement}
        >
          {children}
        </div>
      )}
    </span>
  );
}
