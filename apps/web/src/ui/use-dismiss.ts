/** Whether a floating part is open, closing it on a press outside its container or on Escape. */
import { useEffect, useRef, useState } from 'react';

/**
 * The open state of a menu, popover or drawer, closed by a press outside or by Escape. When it
 * closes by Escape or by `close` while focus is inside it, focus goes back to its trigger.
 *
 * @returns The container and trigger refs, whether it is open, and the setters.
 */
export function useDismiss<Element extends HTMLElement = HTMLDivElement>() {
  const container = useRef<Element>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  /** Closes it, and gives focus back to the trigger if focus was inside. */
  const close = () => {
    const focusInside = container.current?.contains(document.activeElement) ?? false;
    setOpen(false);
    if (focusInside) trigger.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: Event) => {
      const outside = !container.current?.contains(event.target as Node);
      if (event.type === 'pointerdown' && outside) setOpen(false);
      if ((event as KeyboardEvent).key === 'Escape') close();
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', dismiss);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', dismiss);
    };
  });
  return { container, trigger, open, setOpen, close, toggle: () => setOpen((current) => !current) };
}
