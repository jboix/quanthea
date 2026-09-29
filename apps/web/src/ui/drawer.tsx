import { type ReactNode, type RefObject, useEffect, useId, useRef } from 'react';
import styles from './drawer.module.css';

/** Props of {@link Drawer}. */
interface DrawerProps {
  /** Whether it shows. */
  readonly open: boolean;
  /** Called when the person closes it: the × button, Escape, or a click outside. */
  readonly onClose: () => void;
  /** The heading, also the dialog's name. */
  readonly title: string;
  /** The content, below the heading. */
  readonly children: ReactNode;
}

/**
 * Closes a modal dialog on a click on its backdrop. Escape, its keyboard counterpart, is native.
 *
 * @param dialog - The dialog.
 * @param onClose - Called on such a click.
 */
function useBackdropClose(dialog: RefObject<HTMLDialogElement | null>, onClose: () => void): void {
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    // A click on the backdrop lands on the dialog itself; the content sits in the panel.
    const onClick = (event: MouseEvent) => {
      if (event.target === element) onClose();
    };
    element.addEventListener('click', onClick);
    return () => element.removeEventListener('click', onClick);
  }, [dialog, onClose]);
}

/**
 * A modal panel that slides in from the right, or down from the top on a narrow screen. It is a
 * native dialog, so focus stays inside it and Escape closes it.
 *
 * @param props - Whether it shows, the close callback, the heading and the content.
 * @returns The dialog.
 */
export function Drawer({ open, onClose, title, children }: DrawerProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);
  useBackdropClose(dialog, onClose);
  return (
    <dialog ref={dialog} className={styles.drawer} aria-labelledby={titleId} onClose={onClose}>
      <div className={styles.panel}>
        <header className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
