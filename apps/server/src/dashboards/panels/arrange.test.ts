import { describe, expect, test } from 'bun:test';
import type { DashboardSpec, Panel } from '@quanthea/shared';
import { edit, firstBuild, issuesOf, specOf } from './fixtures.ts';
import { layoutReport } from './layout-check.ts';
import { layoutMap } from './layout-map.ts';

/** The first build as the server places it when the edit arranges nothing. */
const built = specOf(undefined, firstBuild);

/**
 * The built dashboard after an edit that only arranges.
 *
 * @param rows - The rows of `arrange`.
 * @param from - The spec to arrange.
 * @returns The spec.
 */
function arranged(rows: string[][], from: DashboardSpec = built): DashboardSpec {
  return specOf(from, edit({ arrange: rows, summary: 'arranged' }));
}

/**
 * Many panels in rows of three, each a copy of a built one under a new id.
 *
 * @param count - How many.
 * @returns The panels.
 */
function manyPanels(count: number): Panel[] {
  const [stat, , , time, chart] = built.panels;
  return Array.from({ length: count }, (_, index) => {
    const source = [stat, time, chart][index % 3] as Panel;
    const grid = { x: (index % 3) * 4, y: Math.floor(index / 3) * 7, w: 4, h: 7 };
    return { ...source, id: `checkout-requests-${index + 1}`, grid };
  });
}

/** The place beside a table that takes the left half of the first row. */
const besideTable = { x: 6, y: 0, w: 6, h: 7 };

/** A chart of the built dashboard that is not over time. */
const chartPanel = built.panels[4] as Panel;

/**
 * A table on the first row.
 *
 * @param fields - How many columns it shows.
 * @param w - The grid columns it takes.
 * @returns The panel, with the id `slowest`.
 */
function tableOf(fields: number, w: number): Panel {
  const columns = Array.from({ length: fields }, (_, index) => ({ field: `field_${index}` }));
  const view = { kind: 'table' as const, ref: 'A', columns };
  return { ...chartPanel, id: 'slowest', title: 'Slowest', grid: { x: 0, y: 0, w, h: 7 }, view };
}

describe('the layout map', () => {
  test('reads the grid row by row, with each panel’s kind and columns, and the gaps', () => {
    expect(layoutMap(built.panels)).toEqual([
      'y0 h3: error-rate stat 1-3 | failed-orders stat 4-6 | gap 7-12',
      'y3 h8: latency time 1-12',
      'y11 h8: orders-by-status time 1-12',
      'y19 h7: top-codes chart 1-6 | gap 7-12',
    ]);
  });

  test('shows a panel that reaches into a row from above, and a panel of another height', () => {
    const [first, second, third] = built.panels as [Panel, Panel, Panel];
    const panels = [
      { ...first, grid: { x: 0, y: 0, w: 6, h: 6 } },
      { ...second, grid: { x: 6, y: 0, w: 6, h: 3 } },
      { ...third, grid: { x: 6, y: 3, w: 4, h: 3 } },
    ];
    expect(layoutMap(panels)).toEqual([
      'y0 h6: error-rate stat 1-6 | failed-orders stat 7-12 h3',
      'y3 h3: (error-rate) 1-6 | latency time 7-10 | gap 11-12',
    ]);
  });

  test('stays small: its characters for 12 and for 30 panels', () => {
    const sizeOf = (count: number) => JSON.stringify(layoutMap(manyPanels(count))).length;
    // Measured at 414 and 1050 characters, with ids of twenty characters.
    expect(sizeOf(12)).toBeLessThan(450);
    expect(sizeOf(30)).toBeLessThan(1100);
  });
});

describe('named arrangements', () => {
  test('turn rows into grid numbers that fill the grid, and the spec stays valid', () => {
    const spec = arranged([
      ['stats', 'error-rate', 'Failed orders'],
      ['two', 'latency', 'orders-by-status'],
      ['full', 'top-codes'],
    ]);
    expect(spec.panels.map((panel) => [panel.id, panel.grid])).toEqual([
      ['error-rate', { x: 0, y: 0, w: 6, h: 3 }],
      ['failed-orders', { x: 6, y: 0, w: 6, h: 3 }],
      ['latency', { x: 0, y: 3, w: 6, h: 8 }],
      ['orders-by-status', { x: 6, y: 3, w: 6, h: 8 }],
      ['top-codes', { x: 0, y: 11, w: 12, h: 7 }],
    ]);
    expect(issuesOf(spec)).toEqual([]);
    expect(layoutReport(spec.panels).advice).toBeUndefined();
  });

  test('place the rows from the top and leave the other panels below, as they were', () => {
    const spec = arranged([['chart-table', 'top-codes', 'latency']]);
    expect(layoutMap(spec.panels)).toEqual([
      'y0 h8: top-codes chart 1-7 | latency time 8-12',
      'y8 h3: error-rate stat 1-3 | failed-orders stat 4-6 | gap 7-12',
      'y11 h8: orders-by-status time 1-12',
    ]);
  });

  test('three across fills the last row, and five numbers share one', () => {
    const three = arranged([['three', ...built.panels.map((panel) => panel.id)]]);
    expect(three.panels.map((panel) => panel.grid.w)).toEqual([4, 4, 4, 6, 6]);
    const stats = arranged([['stats', ...built.panels.map((panel) => panel.id)]]);
    expect(stats.panels.map((panel) => [panel.grid.y, panel.grid.w])).toEqual([
      [0, 3],
      [0, 3],
      [0, 2],
      [0, 2],
      [0, 2],
    ]);
  });

  test('arrange the panels an edit adds, by their titles', () => {
    const request = edit({ ...firstBuild, arrange: [['three', 'Error rate', 'Failed orders']] });
    expect(layoutMap(specOf(undefined, request).panels).slice(0, 2)).toEqual([
      'y0 h3: error-rate stat 1-6 | failed-orders stat 7-12',
      'y3 h8: latency time 1-12',
    ]);
  });

  test('refuse a row that cannot be placed, with what to send instead', () => {
    const refusalOf = (rows: string[][]) => {
      try {
        arranged(rows);
        return 'placed';
      } catch (error) {
        return (error as Error).message;
      }
    };
    expect(refusalOf([['grid', 'latency']])).toBe(
      'No arrangement "grid". A row of "arrange" starts with one of: stats, chart-table, full, two, three.',
    );
    expect(refusalOf([['full', 'nope']])).toBe(
      '"arrange" names no panel "nope". The panels are: error-rate, failed-orders, latency, orders-by-status, top-codes.',
    );
    expect(
      refusalOf([
        ['full', 'latency'],
        ['two', 'Latency'],
      ]),
    ).toBe('"arrange" places "latency" twice.');
    expect(refusalOf([['chart-table', 'latency']])).toBe('"chart-table" takes two panels.');
    expect(refusalOf([['stats']])).toBe('"stats" takes at least one panel.');
  });
});

describe('the layout check', () => {
  test('advises on gaps in the server’s own placement', () => {
    expect(layoutReport(built.panels).advice).toEqual([
      'Row y0 leaves columns 7-12 empty: arrange its panels to fill the row.',
      'Row y19 leaves columns 7-12 empty: arrange its panels to fill the row.',
    ]);
  });

  test('advises on numbers below charts, a number too wide and a chart too short', () => {
    const spec = arranged([['full', 'latency', 'error-rate']]);
    const short = spec.panels.map((panel) =>
      panel.id === 'latency' ? { ...panel, grid: { ...panel.grid, h: 3 } } : panel,
    );
    expect(layoutReport(short).advice).toEqual([
      'The numbers "error-rate", "failed-orders" sit below a chart or a table: put the numbers first, in a "stats" row.',
      'Row y11 leaves columns 1-3 and 7-12 empty: arrange its panels to fill the row.',
      'Row y22 leaves columns 7-12 empty: arrange its panels to fill the row.',
      '"error-rate" is a number 12 columns wide, more than it needs: put it in a "stats" row with the other numbers, or beside a chart.',
      '"latency" is a chart 3 rows tall, too short for its legend: arrange it again and it takes its usual height.',
    ]);
  });

  test('advises on a table too narrow for its columns, with a repair that is wide enough', () => {
    expect(layoutReport([tableOf(6, 12)]).advice).toBeUndefined();
    expect(layoutReport([tableOf(6, 4)]).advice).toEqual([
      'Row y0 leaves columns 5-12 empty: arrange its panels to fill the row.',
      '"slowest" is a table of 6 columns in 4 grid columns: give it at least 6, with "two" or "full".',
    ]);
    expect(layoutReport([tableOf(8, 6), { ...chartPanel, grid: besideTable }]).advice).toEqual([
      '"slowest" is a table of 8 columns in 6 grid columns: give it the whole row, with "full".',
    ]);
  });

  test('never advises on a table that has the whole row, however many columns it has', () => {
    expect(layoutReport([tableOf(30, 12)]).advice).toBeUndefined();
  });

  test('finds nothing to repair in a row the server arranged by name', () => {
    const [first, second, time, , chart] = built.panels as [Panel, Panel, Panel, Panel, Panel];
    const adviceOf = (rows: string[][], ...panels: Panel[]) =>
      layoutReport(arranged(rows, { ...built, panels }).panels).advice;
    expect(adviceOf([['stats', 'error-rate', 'failed-orders']], first, second)).toBeUndefined();
    expect(
      adviceOf([['chart-table', 'top-codes', 'slowest']], chart, tableOf(5, 6)),
    ).toBeUndefined();
    expect(
      adviceOf([['chart-table', 'slowest', 'top-codes']], tableOf(4, 6), chart),
    ).toBeUndefined();
    expect(adviceOf([['two', 'latency', 'slowest']], time, tableOf(6, 4))).toBeUndefined();
    expect(
      adviceOf([['three', 'slowest', 'latency', 'top-codes']], tableOf(4, 6), time, chart),
    ).toBeUndefined();
    expect(adviceOf([['full', 'slowest', 'latency']], tableOf(12, 6), time)).toBeUndefined();
  });

  test('names a repair that leaves no advice on the table, for every number of columns', () => {
    const [, , time] = built.panels as [Panel, Panel, Panel];
    for (let fields = 1; fields <= 14; fields += 1) {
      const narrow = [tableOf(fields, 1), { ...time, grid: { x: 1, y: 0, w: 11, h: 7 } }];
      const [told] = layoutReport(narrow).advice ?? [];
      if (fields === 1) expect(told).toBeUndefined();
      else expect(told).toContain(`"slowest" is a table of ${fields} columns in 1 grid columns`);
      const repair = told?.includes('"two"') ? 'two' : 'full';
      const repaired = arranged([[repair, 'slowest', 'latency']], { ...built, panels: narrow });
      expect(layoutReport(repaired.panels).advice).toBeUndefined();
    }
  });

  test('reads a report’s grid without its headline numbers, and names a number left on it', () => {
    const report = layoutReport(built.panels, { headlines: ['error-rate'] });
    expect(report.rows.slice(0, 2)).toEqual([
      'headline numbers: error-rate',
      'y0 h3: gap 1-3 | failed-orders stat 4-6 | gap 7-12',
    ]);
    expect(report.advice?.[0]).toBe(
      '"failed-orders" is a number outside the headline row: name it in "summaryPanels" and it leads the report.',
    );
  });

  test('gives the map alone when asked for no advice', () => {
    expect(layoutReport(built.panels, { advise: false })).toEqual({
      rows: layoutMap(built.panels),
    });
  });
});
