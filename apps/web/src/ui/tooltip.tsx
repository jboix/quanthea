import { type ReactNode, useId } from 'react';
import styles from './tooltip.module.css';

/** Props of {@link Tooltip}. */
interface TooltipProps {
  /** What the tooltip says. */
  readonly text: string;
  /** The control, given the id it must name in `aria-describedby`. */
  readonly children: (describedBy: string) => ReactNode;
}

/**
 * A short note under a control, shown while the control is hovered or focused. The control names
 * it in `aria-describedby`, so screen readers read it too.
 *
 * @param props - The text and the control.
 * @returns The control with its note.
 */
export function Tooltip({ text, children }: TooltipProps) {
  const id = useId();
  return (
    <span className={styles.anchor}>
      {children(id)}
      <span id={id} role="tooltip" className={styles.tip}>
        {text}
      </span>
    </span>
  );
}
