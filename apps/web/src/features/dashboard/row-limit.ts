/** Whether a panel's chart draws a result its source cut short. */
import type { Panel, QueryOutcome } from '@quanthea/shared';

/** What a chart says under it when a result was cut at its source's row limit. */
export const rowLimitNote =
  'The source returned more than its row limit, so this chart is cut short. ' +
  'Narrow the time range to see the rest.';

/**
 * Whether a chart panel draws a result cut at the row limit: rows past it, or series past the
 * most one query returns, were dropped, and the frame says so.
 *
 * @param panel - The panel.
 * @param queries - The outcome of each of its queries.
 * @returns `true` for a chart with a cut result. A table says how many rows it shows itself, and
 *   a stat reads one number.
 */
export function cutAtRowLimit(panel: Panel, queries: readonly QueryOutcome[]): boolean {
  if (panel.view.kind !== 'chart') return false;
  return queries.some((query) => query.frames.some((frame) => frame.meta.truncated));
}
