/** Pages through a list the page holds whole, such as the series of an alert. */
import { useState } from 'react';
import { pageStart } from './paging.ts';

/** One page of a list held whole, and what moves to the pages beside it. */
export interface LocalPages<Item> {
  /** The entries of the page shown. */
  readonly shown: readonly Item[];
  /** How many entries come before the page's first. */
  readonly offset: number;
  /** Shows the page before; `undefined` on the first page. */
  readonly onBefore: (() => void) | undefined;
  /** Shows the page after; `undefined` on the last page. */
  readonly onAfter: (() => void) | undefined;
}

/**
 * Pages through a list held whole. When the list shrinks under the page chosen, the last page it
 * still has is shown.
 *
 * @param items - The whole list, in the order shown.
 * @param size - How many entries a page shows.
 * @returns The page shown and its controls.
 */
export function useLocalPages<Item>(items: readonly Item[], size: number): LocalPages<Item> {
  const [chosen, setChosen] = useState(0);
  const offset = pageStart(chosen, size, items.length);
  const end = offset + size;
  return {
    shown: items.slice(offset, end),
    offset,
    onBefore: offset > 0 ? () => setChosen(offset - size) : undefined,
    onAfter: end < items.length ? () => setChosen(end) : undefined,
  };
}
