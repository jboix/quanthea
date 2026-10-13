/** The words of a pager: which entries of a list a page shows. */

/**
 * Says which entries a page shows and how many the list holds.
 *
 * @param offset - How many entries come before the page's first.
 * @param shown - How many entries the page shows.
 * @param total - How many entries the list holds in all.
 * @returns Such as `11–20 of 57`, or `1 of 1`; `0` for an empty list.
 */
export function pageRange(offset: number, shown: number, total: number): string {
  if (shown === 0) return `${total}`;
  const first = offset + 1;
  const last = offset + shown;
  return first === last ? `${first} of ${total}` : `${first}–${last} of ${total}`;
}

/**
 * Whether a list needs the controls of a pager: it holds more than its page shows.
 *
 * @param shown - How many entries the page shows.
 * @param total - How many entries the list holds in all.
 * @returns `true` when there is another page.
 */
export function hasPages(shown: number, total: number): boolean {
  return total > shown;
}

/**
 * Where a page of a list held whole starts, when the list may have shrunk since it was chosen.
 *
 * @param chosen - Where the page chosen starts.
 * @param size - How many entries a page shows.
 * @param total - How many entries the list holds now.
 * @returns The start of the page chosen, or of the last page the list still has.
 */
export function pageStart(chosen: number, size: number, total: number): number {
  const last = Math.max(0, Math.ceil(total / size) - 1) * size;
  return Math.min(Math.max(0, chosen), last);
}
