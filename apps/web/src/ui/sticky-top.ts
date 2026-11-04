/**
 * A header that stays at the top of its scrolling screen, and tells what scrolls under it how tall
 * it is, so a bar below it, such as a dashboard's variables, can stay right under it.
 */
import { type RefObject, useLayoutEffect } from 'react';

/** The custom property the header sets on its parent: its height, in pixels. */
export const stickyTopProperty = '--sticky-top';

/**
 * Keeps the header's height on its parent as {@link stickyTopProperty} while it is sticky.
 *
 * @param header - The header element.
 * @param sticky - Whether the header is sticky.
 */
export function useStickyTop(header: RefObject<HTMLElement | null>, sticky: boolean): void {
  useLayoutEffect(() => {
    const element = header.current;
    const parent = element?.parentElement;
    if (!sticky || !element || !parent) return;
    const publish = () =>
      parent.style.setProperty(stickyTopProperty, `${element.getBoundingClientRect().height}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    return () => {
      observer.disconnect();
      parent.style.removeProperty(stickyTopProperty);
    };
  }, [header, sticky]);
}
