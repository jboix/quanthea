import { describe, expect, test } from 'bun:test';
import type { DashboardSpec } from '@quanthea/shared';
import { fitTableHeights, tableHeight } from './fit-heights.ts';
import { edit, specOf, testOf } from './fixtures.ts';

/** A raw SQL request over the shop. */
const data = { kind: 'raw', connector: 'shop', language: 'sql', query: 'SELECT status, n FROM t' };

/**
 * A dashboard of panels, placed in reading order.
 *
 * @param panels - Each panel's title, recipe and width.
 * @returns The spec.
 */
function dashboardOf(panels: [string, string, string][]): DashboardSpec {
  return specOf(
    undefined,
    edit({
      title: 'Orders',
      summary: 'Orders',
      panels: panels.map(([title, recipe, width]) => ({ title, data, width, chart: { recipe } })),
    }),
  );
}

/**
 * The test run of a table of some rows.
 *
 * @param panelId - The panel.
 * @param rows - The rows.
 * @returns The run.
 */
function rowsOf(panelId: string, rows: number) {
  const values = Array.from({ length: rows }, (_, index) => index);
  return testOf(
    panelId,
    [
      { name: 'status', type: 'string' },
      { name: 'n', type: 'number' },
    ],
    [values.map(String), values],
  );
}

/**
 * The grid of each panel, by id.
 *
 * @param spec - The spec.
 * @returns `id: y h` per panel.
 */
function gridOf(spec: DashboardSpec): string[] {
  return spec.panels.map((panel) => `${panel.id}: y${panel.grid.y} h${panel.grid.h}`);
}

describe('fitting tables to their rows', () => {
  test('a table needs 4 to 10 grid rows', () => {
    expect([0, 3, 5, 8, 11, 40].map(tableHeight)).toEqual([4, 4, 5, 7, 9, 10]);
  });

  test('a short table alone in its row gets shorter, and the rows below move up', () => {
    const spec = dashboardOf([
      ['Orders', 'table.rows', 'full'],
      ['By status', 'composition.pie', 'full'],
    ]);
    const added = new Set(['orders', 'by-status']);
    const fitted = fitTableHeights(spec, [rowsOf('orders', 3)], added);
    expect(gridOf(fitted)).toEqual(['orders: y0 h4', 'by-status: y4 h7']);
  });

  test('a short table beside a chart keeps the chart height', () => {
    const spec = dashboardOf([
      ['Orders', 'table.rows', 'half'],
      ['By status', 'composition.pie', 'half'],
    ]);
    const fitted = fitTableHeights(spec, [rowsOf('orders', 3)], new Set(['orders']));
    expect(gridOf(fitted)).toEqual(['orders: y0 h7', 'by-status: y0 h7']);
  });

  test('a long table makes its row taller, the chart beside it too', () => {
    const spec = dashboardOf([
      ['Orders', 'table.rows', 'half'],
      ['By status', 'composition.pie', 'half'],
      ['Totals', 'composition.pie', 'full'],
    ]);
    const fitted = fitTableHeights(spec, [rowsOf('orders', 40)], new Set(['orders']));
    expect(gridOf(fitted)).toEqual(['orders: y0 h10', 'by-status: y0 h10', 'totals: y10 h7']);
  });

  test('a table the edit does not add keeps its height', () => {
    const spec = dashboardOf([['Orders', 'table.rows', 'full']]);
    expect(fitTableHeights(spec, [rowsOf('orders', 3)], new Set())).toEqual(spec);
  });

  test('a grid whose panels reach into the next row stays as it is', () => {
    const spec = dashboardOf([
      ['Orders', 'table.rows', 'half'],
      ['By status', 'composition.pie', 'half'],
    ]);
    const [table, chart] = spec.panels;
    if (!table || !chart) throw new Error('two panels expected');
    const reaching = { ...chart, grid: { ...chart.grid, y: 3 } };
    const arranged = { ...spec, panels: [table, reaching] };
    expect(fitTableHeights(arranged, [rowsOf('orders', 3)], new Set(['orders']))).toEqual(arranged);
  });
});
