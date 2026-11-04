/**
 * Fits the height of each table an edit adds to the rows its test run returned, so a short table
 * leaves no empty space and a long one shows more before it scrolls. The panels of its grid row
 * as tall as the row keep its height, none gets shorter than it was, and the rows below move by
 * the difference.
 */
import { type DashboardSpec, datasetOfFrames, type Panel } from '@quanthea/shared';
import type { PanelTest } from '../versions.ts';

/** The fewest and the most grid rows a fitted table takes. */
const tableRows = { min: 4, max: 10 };

/**
 * The grid rows a table of some rows needs: its title, header and padding take 110 px, a row
 * 33 px, and a grid row is 40 px with a 16 px gap.
 *
 * @param rows - The table's rows.
 * @returns The grid rows, from 4 to 10.
 */
export function tableHeight(rows: number): number {
  const needed = Math.ceil((110 + 33 * rows) / 56);
  return Math.min(tableRows.max, Math.max(tableRows.min, needed));
}

/**
 * The height an added table fits, if the panel is one and its test run returned rows.
 *
 * @param panel - The panel.
 * @param tests - The test run.
 * @param added - The ids of the panels the edit adds.
 * @returns The grid rows, or `undefined` to keep the panel's height.
 */
function fittedHeight(
  panel: Panel,
  tests: readonly PanelTest[],
  added: ReadonlySet<string>,
): number | undefined {
  if (!added.has(panel.id) || panel.view.kind !== 'table' || panel.view.record) return undefined;
  const outcome = tests.find((test) => test.panelId === panel.id)?.run.queries[0];
  if (!outcome || outcome.error) return undefined;
  return tableHeight(datasetOfFrames(outcome.frames).source.length);
}

/**
 * The grid rows of the panels: each row's top, and the height of its tallest panel. There are none
 * when a panel reaches into the next row, as a person may arrange it.
 *
 * @param panels - The panels.
 * @returns The height of each row by its top, or `undefined` when the grid has no clean rows.
 */
function gridRows(panels: readonly Panel[]): Map<number, number> | undefined {
  const rows = new Map<number, number>();
  for (const { grid } of panels) rows.set(grid.y, Math.max(rows.get(grid.y) ?? 0, grid.h));
  const tops = [...rows.keys()].sort((a, b) => a - b);
  const clean = tops.every((top, index) => {
    const next = tops[index + 1];
    return next === undefined || top + (rows.get(top) ?? 0) <= next;
  });
  return clean ? rows : undefined;
}

/**
 * The new height of each row with a fitted table: its tallest fitted table, or its tallest other
 * panel when that is taller, so a table never makes a chart beside it shorter.
 *
 * @param panels - The panels.
 * @param fitted - The fitted height of each table, by id.
 * @returns The new height by row top, for the rows that have a fitted table.
 */
function rowHeights(panels: readonly Panel[], fitted: ReadonlyMap<string, number>) {
  const tops = new Set(panels.filter((panel) => fitted.has(panel.id)).map((panel) => panel.grid.y));
  const heights = new Map<number, number>();
  for (const panel of panels) {
    if (!tops.has(panel.grid.y)) continue;
    const height = fitted.get(panel.id) ?? panel.grid.h;
    heights.set(panel.grid.y, Math.max(heights.get(panel.grid.y) ?? 0, height));
  }
  return heights;
}

/**
 * The height of a panel in a resized row: a fitted table and a panel as tall as the row take the
 * row's new height, a shorter panel keeps its own.
 *
 * @param panel - The panel.
 * @param row - The row's height before.
 * @param height - The row's new height, if it changes.
 * @param fitted - The fitted tables, by id.
 * @returns The height.
 */
function heightIn(
  panel: Panel,
  row: number | undefined,
  height: number | undefined,
  fitted: ReadonlyMap<string, number>,
): number {
  if (height === undefined) return panel.grid.h;
  return fitted.has(panel.id) || panel.grid.h === row ? height : panel.grid.h;
}

/**
 * The panels with each grid row at its new height and the rows below moved by the difference.
 *
 * @param panels - The panels, in clean grid rows.
 * @param rows - The height of each row by its top.
 * @param fitted - The fitted tables, by id.
 * @returns The panels.
 */
function resized(
  panels: readonly Panel[],
  rows: ReadonlyMap<number, number>,
  fitted: ReadonlyMap<string, number>,
): Panel[] {
  const heights = rowHeights(panels, fitted);
  const shift = (top: number) =>
    [...heights].reduce(
      (sum, [y, height]) => (y < top ? sum + height - (rows.get(y) ?? height) : sum),
      0,
    );
  return panels.map((panel) => {
    const { y } = panel.grid;
    const h = heightIn(panel, rows.get(y), heights.get(y), fitted);
    return { ...panel, grid: { ...panel.grid, y: y + shift(y), h } };
  });
}

/**
 * Fits the tables an edit adds to their test rows. A grid whose panels do not sit in clean rows,
 * as a person may arrange it, stays as it is.
 *
 * @param spec - The spec.
 * @param tests - Its test run.
 * @param added - The ids of the panels the edit adds.
 * @returns The spec, its added tables fitted.
 */
export function fitTableHeights(
  spec: DashboardSpec,
  tests: readonly PanelTest[],
  added: ReadonlySet<string>,
): DashboardSpec {
  const fitted = new Map<string, number>();
  for (const panel of spec.panels) {
    const height = fittedHeight(panel, tests, added);
    if (height !== undefined) fitted.set(panel.id, height);
  }
  const rows = fitted.size > 0 ? gridRows(spec.panels) : undefined;
  if (!rows) return spec;
  return { ...spec, panels: resized(spec.panels, rows, fitted) };
}
