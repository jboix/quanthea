/**
 * How many points a series of a panel's time chart can show, from the panel's width on the grid.
 * A chart cannot show more points than it has pixels, so a run asks its source for no more: the
 * query engine raises the interval of the panel's queries to fit.
 */
import type { Panel } from '@quanthea/shared';
import { isTimeChart } from './panels/time-chart.ts';

/**
 * The points one grid column has room for. A column of the 12-column grid is at most about 200
 * pixels wide on a wide screen, so a full-width chart gets 2400 points and a half-width one 1200.
 */
export const pointsPerGridColumn = 200;

/**
 * The most points a series of a panel can show.
 *
 * @param panel - The panel, at the width it is drawn.
 * @returns The points for a chart over time, or `undefined` for a stat, a table or any other
 *   chart, which read what their queries return.
 */
export function chartPointsOf(panel: Panel): number | undefined {
  return isTimeChart(panel.view) ? panel.grid.w * pointsPerGridColumn : undefined;
}
