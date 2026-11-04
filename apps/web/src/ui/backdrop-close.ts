import { type RefObject, useEffect } from 'react';

/**
 * Closes a modal dialog on a click on its backdrop. Escape, its keyboard counterpart, is native.
 * A click counts only when the press started on the backdrop too, so a text selection dragged
 * out of the dialog leaves it open.
 *
 * @param dialog - The dialog, whose content sits in one child that fills it.
 * @param onClose - Called on such a click.
 */
export function useBackdropClose(
  dialog: RefObject<HTMLDialogElement | null>,
  onClose: () => void,
): void {
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    // A press on the backdrop lands on the dialog itself; the content sits in its child.
    let pressed = false;
    const onDown = (event: PointerEvent) => {
      pressed = event.target === element;
    };
    const onClick = (event: MouseEvent) => {
      if (pressed && event.target === element) onClose();
      pressed = false;
    };
    element.addEventListener('pointerdown', onDown);
    element.addEventListener('click', onClick);
    return () => {
      element.removeEventListener('pointerdown', onDown);
      element.removeEventListener('click', onClick);
    };
  }, [dialog, onClose]);
}
