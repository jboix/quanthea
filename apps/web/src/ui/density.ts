/**
 * The density of the panels of dashboards, reports and alerts: airy gives them room, compact
 * draws them closer and joins a grid's panels into one block. Titles, margins and other screens
 * stay as they are. The choice is kept per browser, like the colour scheme, and applied as
 * `data-density` on the document element, which the panel spacing tokens read.
 */
import { useSyncExternalStore } from 'react';

/** What the person picks. */
export type Density = 'airy' | 'compact';

/** Where the choice is kept. */
const storageKey = 'quanthea.density';

/** The event a change of density sends on the window. */
const changeEvent = 'quanthea:density';

/**
 * The kept choice; airy when none is kept or storage is unavailable.
 *
 * @returns The choice.
 */
export function storedDensity(): Density {
  try {
    return localStorage.getItem(storageKey) === 'compact' ? 'compact' : 'airy';
  } catch {
    return 'airy';
  }
}

/**
 * Applies a choice to the document, and tells the listeners.
 *
 * @param density - The choice.
 */
export function applyDensity(density: Density): void {
  document.documentElement.dataset.density = density;
  window.dispatchEvent(new Event(changeEvent));
}

/**
 * Keeps a choice and applies it.
 *
 * @param density - The choice.
 */
function chooseDensity(density: Density): void {
  try {
    localStorage.setItem(storageKey, density);
  } catch {
    // Without storage the choice lasts until the page reloads.
  }
  applyDensity(density);
}

/**
 * Calls back when the density changes.
 *
 * @param onChange - The callback.
 * @returns Stops listening.
 */
function subscribe(onChange: () => void): () => void {
  window.addEventListener(changeEvent, onChange);
  return () => window.removeEventListener(changeEvent, onChange);
}

/**
 * The person's choice and a way to change it.
 *
 * @returns The choice and the setter.
 */
export function useDensity(): readonly [Density, (density: Density) => void] {
  const density = useSyncExternalStore(subscribe, storedDensity, () => 'airy' as const);
  return [density, chooseDensity] as const;
}
