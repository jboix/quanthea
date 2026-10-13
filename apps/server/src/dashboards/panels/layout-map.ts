/**
 * A layout as a map the agent can read: the 12-column grid row by row, each panel with its kind
 * and the columns it takes, and the columns left empty. It names panels and places only, never a
 * value of the data.
 */
import { chartRecipe, gridColumns, type Panel } from '@quanthea/shared';
import type { PanelShape } from './draft.ts';
import { isTimeChart } from './expand.ts';

/**
 * What a panel shows, read from its view: the kind the map names and the layout check judges.
 *
 * @param panel - The panel.
 * @returns The shape.
 */
export function shapeOfPanel(panel: Pick<Panel, 'view'>): PanelShape {
  const { view } = panel;
  if (view.kind !== 'chart') return view.kind;
  if (chartRecipe(view.recipe?.id ?? '')?.family === 'kpi') return 'stat';
  return isTimeChart(view) && view.prepare !== 'facets' ? 'time' : 'chart';
}

/** One row of a layout: the panels that start on the same grid line. */
interface LayoutRow {
  /** The grid line the row starts on. */
  readonly y: number;
  /** The panels that start there, left to right. */
  readonly panels: readonly Panel[];
  /** The panels that start above and reach into the row, left to right. */
  readonly above: readonly Panel[];
  /** The runs of columns nothing covers, as `[first, last]`, counted from 1. */
  readonly gaps: readonly (readonly [number, number])[];
}

/**
 * The runs of columns no panel covers.
 *
 * @param covering - The panels on the row.
 * @returns The runs, as `[first, last]`, counted from 1.
 */
function gapsOf(covering: readonly Panel[]): [number, number][] {
  const free = Array.from({ length: gridColumns }, (_, column) =>
    covering.every(({ grid }) => column < grid.x || column >= grid.x + grid.w),
  );
  const gaps: [number, number][] = [];
  free.forEach((empty, column) => {
    if (!empty) return;
    const last = gaps.at(-1);
    if (last && last[1] === column) last[1] = column + 1;
    else gaps.push([column + 1, column + 1]);
  });
  return gaps;
}

/**
 * The rows of a layout, top to bottom.
 *
 * @param panels - The panels.
 * @returns One row per grid line a panel starts on.
 */
export function layoutRows(panels: readonly Panel[]): LayoutRow[] {
  const lines = [...new Set(panels.map((panel) => panel.grid.y))].sort((a, b) => a - b);
  const leftToRight = (a: Panel, b: Panel) => a.grid.x - b.grid.x;
  return lines.map((y) => {
    const starting = panels.filter((panel) => panel.grid.y === y).sort(leftToRight);
    const above = panels
      .filter((panel) => panel.grid.y < y && panel.grid.y + panel.grid.h > y)
      .sort(leftToRight);
    return { y, panels: starting, above, gaps: gapsOf([...starting, ...above]) };
  });
}

/**
 * A run of columns as text.
 *
 * @param first - The first column, counted from 1.
 * @param last - The last column.
 * @returns Such as `1-3`, or `5` for one column.
 */
export function columnsText(first: number, last: number): string {
  return first === last ? String(first) : `${first}-${last}`;
}

/**
 * One row as a line of the map: its panels, the panels reaching in from above in brackets, and
 * its gaps, left to right.
 *
 * @param row - The row.
 * @returns Such as `y0 h3: revenue stat 1-3 | orders stat 4-6 | gap 7-12`.
 */
function rowLine(row: LayoutRow): string {
  const height = Math.max(...row.panels.map((panel) => panel.grid.h));
  const cells = [
    ...row.panels.map(({ id, grid, view }) => {
      const own = grid.h === height ? '' : ` h${grid.h}`;
      const columns = columnsText(grid.x + 1, grid.x + grid.w);
      return { x: grid.x, text: `${id} ${shapeOfPanel({ view })} ${columns}${own}` };
    }),
    ...row.above.map(({ id, grid }) => ({
      x: grid.x,
      text: `(${id}) ${columnsText(grid.x + 1, grid.x + grid.w)}`,
    })),
    ...row.gaps.map(([first, last]) => ({ x: first - 1, text: `gap ${columnsText(first, last)}` })),
  ];
  const line = cells.sort((a, b) => a.x - b.x).map((cell) => cell.text);
  return `y${row.y} h${height}: ${line.join(' | ')}`;
}

/**
 * The map of a layout.
 *
 * @param panels - The panels on the grid.
 * @returns One line per row, top to bottom.
 */
export function layoutMap(panels: readonly Panel[]): string[] {
  return layoutRows(panels).map(rowLine);
}
