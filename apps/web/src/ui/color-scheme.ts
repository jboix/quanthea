/**
 * The colour scheme: light, dark, or the system's. The choice is kept per browser and applied as
 * `data-theme` on the document element, which switches the tokens of `@quanthea/tokens`.
 */
import { useSyncExternalStore } from 'react';

/** What the person picks. */
export type ColorScheme = 'light' | 'dark' | 'system';

/** What the page shows. */
export type ResolvedScheme = 'light' | 'dark';

/** Where the choice is kept. */
const storageKey = 'quanthea.color-scheme';

/** The event a change of scheme sends on the window. */
const changeEvent = 'quanthea:color-scheme';

/** The system's preference. */
const darkQuery = '(prefers-color-scheme: dark)';

/**
 * The kept choice; light when none is kept or storage is unavailable.
 *
 * @returns The choice.
 */
export function storedScheme(): ColorScheme {
  try {
    const stored = localStorage.getItem(storageKey);
    return stored === 'dark' || stored === 'system' ? stored : 'light';
  } catch {
    return 'light';
  }
}

/**
 * What a choice shows now.
 *
 * @param scheme - The choice.
 * @returns Light or dark.
 */
function resolve(scheme: ColorScheme): ResolvedScheme {
  if (scheme !== 'system') return scheme;
  return window.matchMedia(darkQuery).matches ? 'dark' : 'light';
}

/**
 * Applies a choice to the document, and tells the listeners.
 *
 * @param scheme - The choice.
 */
export function applyScheme(scheme: ColorScheme): void {
  const root = document.documentElement;
  const resolved = resolve(scheme);
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  window.dispatchEvent(new Event(changeEvent));
}

/**
 * Keeps a choice and applies it.
 *
 * @param scheme - The choice.
 */
function chooseScheme(scheme: ColorScheme): void {
  try {
    localStorage.setItem(storageKey, scheme);
  } catch {
    // Without storage the choice lasts until the page reloads.
  }
  applyScheme(scheme);
}

/**
 * Follows the system's preference while the choice is `system`.
 *
 * @returns Stops following.
 */
export function followSystemScheme(): () => void {
  const media = window.matchMedia(darkQuery);
  const onChange = () => {
    if (storedScheme() === 'system') applyScheme('system');
  };
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

/**
 * Calls back when the scheme changes.
 *
 * @param onChange - The callback.
 * @returns Stops listening.
 */
function subscribe(onChange: () => void): () => void {
  window.addEventListener(changeEvent, onChange);
  return () => window.removeEventListener(changeEvent, onChange);
}

/**
 * What the page shows now.
 *
 * @returns Light or dark.
 */
function currentResolved(): ResolvedScheme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/**
 * The scheme the page shows, kept current, for what draws its own colours, such as charts.
 *
 * @returns Light or dark.
 */
export function useResolvedScheme(): ResolvedScheme {
  return useSyncExternalStore(subscribe, currentResolved, () => 'light');
}

/**
 * The person's choice and a way to change it.
 *
 * @returns The choice and the setter.
 */
export function useColorScheme(): readonly [ColorScheme, (scheme: ColorScheme) => void] {
  const scheme = useSyncExternalStore(subscribe, storedScheme, () => 'light' as const);
  return [scheme, chooseScheme] as const;
}
