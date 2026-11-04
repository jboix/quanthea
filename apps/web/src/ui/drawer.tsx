import { type ReactNode, useEffect, useId, useRef } from 'react';
import { useBackdropClose } from './backdrop-close.ts';
import styles from './drawer.module.css';
import { TitleHeader } from './title-header.tsx';

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
        <TitleHeader
          size="section"
          title={title}
          titleId={titleId}
          actions={
            <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>
              ×
            </button>
          }
        />
        {children}
      </div>
    </dialog>
  );
}
