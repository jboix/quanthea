/** Closes an open `<details>` menu on a press outside it or on Escape. */
import { useEffect, useRef } from 'react';

/** What a document event does to an open menu: nothing, close it, or close it and refocus. */
export type Dismissal = 'stay' | 'close' | 'refocus';

/**
 * What an event does to an open menu. A press outside closes it; Escape closes it and gives
 * focus back to its summary.
 *
 * @param event - The event's type and key.
 * @param event.type - `pointerdown` or `keydown`.
 * @param event.key - The key pressed, for a key event.
 * @param inside - Whether the event happened inside the menu.
 * @returns What to do.
 */
export function dismissalOf(event: { type: string; key?: string }, inside: boolean): Dismissal {
  if (event.type === 'keydown') return event.key === 'Escape' ? 'refocus' : 'stay';
  return event.type === 'pointerdown' && !inside ? 'close' : 'stay';
}

/**
 * Applies a document event to a menu while it is open.
 *
 * @param element - The `<details>` menu, if it is mounted.
 * @param event - The press or key event.
 */
function applyDismissal(element: HTMLDetailsElement | null, event: Event): void {
  if (!element?.open) return;
  const dismissal = dismissalOf(event as KeyboardEvent, element.contains(event.target as Node));
  if (dismissal === 'stay') return;
  element.open = false;
  if (dismissal === 'refocus') element.querySelector('summary')?.focus();
}

/**
 * A ref for a `<details>` menu that closes on a press outside it or on Escape, and a function
 * that closes it from inside, such as when an option is picked.
 *
 * @returns The ref to put on the `<details>`, and the close function.
 */
export function useDetailsDismiss() {
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    /** Applies an event to the menu. */
    const dismiss = (event: Event) => applyDismissal(details.current, event);
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', dismiss);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', dismiss);
    };
  }, []);
  /** Closes the menu. */
  const close = () => details.current?.removeAttribute('open');
  return { details, close };
}
