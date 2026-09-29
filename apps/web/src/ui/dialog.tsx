import { type ReactNode, useEffect, useRef } from 'react';
import styles from './dialog.module.css';

/** Props of {@link Dialog}. */
interface DialogProps {
  /** The dialog's title. */
  readonly title: string;
  /** Whether it is open. */
  readonly open: boolean;
  /** Closes it: the close button, Escape, or the caller once done. */
  readonly onClose: () => void;
  /** The content. */
  readonly children: ReactNode;
}

/**
 * A modal dialog over the page, on the browser's own `<dialog>`: it keeps focus inside and closes
 * with Escape.
 *
 * @param props - The title, whether it is open, the close handler and the content.
 * @returns The dialog.
 */
export function Dialog({ title, open, onClose, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog ref={ref} className={styles.dialog} aria-label={title} onClose={onClose}>
      <header className={styles.header}>
        <h2 className={styles.title}>{title}</h2>
        <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>
      {open && children}
    </dialog>
  );
}
