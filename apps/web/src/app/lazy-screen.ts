/** The lazy part of a route whose screen loads with its own chunk. */
import type { ComponentType } from 'react';

/**
 * A route's lazy screen: a new object on each call, because React Router fills one in once it
 * resolves.
 *
 * @param load - Loads the screen's component.
 * @returns The route's `lazy` value.
 */
export function lazyScreen(load: () => Promise<ComponentType>): {
  readonly Component: () => Promise<ComponentType>;
} {
  return { Component: load };
}
