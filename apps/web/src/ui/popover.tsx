import type { ReactNode } from 'react';
import styles from './popover.module.css';
import { useDismiss } from './use-dismiss.ts';
import { useFittedAlign } from './use-fitted-align.ts';

/** Props of {@link Popover}. */
interface PopoverProps {
  /** What the button says to screen readers, and the dialog's name. */
  readonly label: string;
  /** What the button shows: an icon, or text. */
  readonly trigger: ReactNode;
  /**
   * The button: a small round icon button, a text button, or an icon button as tall as a text
   * button. The icon shapes carry the label as their accessible name.
   */
  readonly shape?: 'icon' | 'button' | 'iconButton';
  /**
   * A short visible note while the button is hovered or focused and the card is shut: under the
   * button, or beside it at once when the card opens beside it.
   */
  readonly tip?: string;
  /** Which edge of the button the popover lines up with; the other when that runs off screen. */
  readonly align?: 'start' | 'end';
  /** Where the card opens: below the button, or beside it, rising from its bottom edge. */
  readonly placement?: 'below' | 'side';
  /** A class for the button, in place of the shape's, such as a navigation rail link's. */
  readonly triggerClassName?: string;
  /** The content, or a function of the callback that closes the card, for content that acts. */
  readonly children: ReactNode | ((close: () => void) => ReactNode);
}

/**
 * A button that opens a small floating card of details, closed by a press outside or Escape, or by
 * its content when an action in it is chosen. Closing it from inside gives focus back to the
 * button.
 *
 * @param props - The label, the trigger, its shape, tip and class, where it opens, and the content.
 * @returns The button and, when open, its card.
 */
export function Popover({
  label,
  trigger,
  shape = 'icon',
  tip,
  align: askedAlign = 'start',
  placement = 'below',
  triggerClassName,
  children,
}: PopoverProps) {
  const popover = useDismiss<HTMLSpanElement>();
  const [card, align] = useFittedAlign(popover.open, askedAlign);
  return (
    <span ref={popover.container} className={styles.popover}>
      <button
        ref={popover.trigger}
        type="button"
        className={triggerClassName ?? styles[shape]}
        aria-label={shape === 'button' ? undefined : label}
        aria-expanded={popover.open}
        aria-haspopup="dialog"
        onClick={popover.toggle}
      >
        {trigger}
      </button>
      {tip && !popover.open && <PopoverTip text={tip} beside={placement === 'side'} />}
      {popover.open && (
        <div
          ref={card}
          role="dialog"
          aria-label={label}
          className={styles.card}
          data-align={align}
          data-placement={placement}
        >
          {typeof children === 'function' ? children(popover.close) : children}
        </div>
      )}
    </span>
  );
}

/**
 * The visible name of an icon button, by it while it is hovered or focused. The button carries
 * the same words as its accessible name, so screen readers skip this.
 *
 * @param props - The words and where they show.
 * @param props.text - The words.
 * @param props.beside - Whether they show beside the button at once, rather than under it.
 * @returns The note.
 */
function PopoverTip({ text, beside }: { readonly text: string; readonly beside: boolean }) {
  return (
    <span className={styles.tip} data-side={beside ? 'right' : 'below'} aria-hidden="true">
      {text}
    </span>
  );
}
