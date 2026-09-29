/** Whether a floating part is open, closing it on a press outside its container or on Escape. */
import { useEffect, useRef, useState } from 'react';

/**
 * The open state of a menu, popover or drawer, closed by a press outside or by Escape.
 *
 * @returns The container ref, whether it is open, and the setters.
 */
export function useDismiss<Element extends HTMLElement = HTMLDivElement>() {
  const container = useRef<Element>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      const outside = !container.current?.contains(event.target as Node);
      const escaped = (event as KeyboardEvent).key === 'Escape';
      if ((event.type === 'pointerdown' && outside) || escaped) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  return { container, open, setOpen, toggle: () => setOpen((current) => !current) };
}
