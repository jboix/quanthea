/** Whether a CSS media query matches, kept current as the window changes. */
import { useSyncExternalStore } from 'react';

/**
 * Whether a media query matches now, re-rendering when that changes.
 *
 * @param query - Such as `(max-width: 720px)`.
 * @returns Whether it matches.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
