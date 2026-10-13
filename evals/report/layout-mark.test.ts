import { describe, expect, test } from 'bun:test';
import { dashboardSpecSchema, type Panel } from '@quanthea/shared';
import type { Outcome } from '../checks/dashboard.ts';
import { reasonsOf } from '../core/result.ts';
import { reportOf } from '../core/test/scoring.ts';
import { panelsOf } from '../surfaces/dashboard.ts';
import { dashboardLayout, layoutMark, layoutParts, layoutReasons } from './layout-mark.ts';
import { htmlReport, markdownReport } from './render.ts';
import { htmlLayout, layoutCell, layoutLine, markdownLayout } from './render-layout.ts';
import { familyRows } from './render-parity.ts';
import { summary } from './summary.ts';

/** A place on the grid, as `[x, y, w, h]`. */
type Place = readonly [number, number, number, number];

/** The views a hand-written panel may have, by a short name. */
const views = {
  stat: { kind: 'stat', ref: 'A', reduce: 'last', format: { $fmt: 'number', decimals: 0 } },
  table: { kind: 'table', ref: 'A', columns: [{ field: 'route' }, { field: 'errors' }] },
  time: { kind: 'chart', option: { xAxis: { type: 'time' } }, datasets: [{ ref: 'A' }] },
};

/**
 * A panel written by hand.
 *
 * @param id - Its id, and its title.
 * @param view - Its view, by name.
 * @param place - Its place on the grid.
 * @param sql - Its query; one of its own by default.
 * @returns The panel, as the spec holds it.
 */
function panel(id: string, view: keyof typeof views, place: Place, sql = `SELECT ${id}`): object {
  const [x, y, w, h] = place;
  const queries = [{ refId: 'A', connector: 'postgres-orders', language: 'sql', sql }];
  return { id, title: id, grid: { x, y, w, h }, queries, view: views[view] };
}

/**
 * The panels of a spec written by hand, checked as the server checks a spec.
 *
 * @param panels - The panels.
 * @returns The parsed panels.
 */
function specPanels(...panels: readonly object[]): Panel[] {
  const spec = { specVersion: 1, title: 'Checkout', time: { from: 'now-24h', to: 'now' }, panels };
  return dashboardSpecSchema.parse(spec).panels;
}

const errorsSql = 'SELECT route, count(*) AS errors FROM requests GROUP BY route';

/** A dashboard that reads well: the numbers, a trend, then a chart beside its table. */
const good = specPanels(
  panel('orders', 'stat', [0, 0, 4, 3]),
  panel('revenue', 'stat', [4, 0, 4, 3]),
  panel('error-rate', 'stat', [8, 0, 4, 3]),
  panel('requests', 'time', [0, 3, 12, 8]),
  panel('errors-by-route', 'time', [0, 11, 7, 8], errorsSql),
  panel('errors-table', 'table', [7, 11, 5, 8], errorsSql),
);

/**
 * The good dashboard with some panels moved.
 *
 * @param places - The new places, by panel id.
 * @returns The panels.
 */
function moved(places: Readonly<Record<string, Place>>): Panel[] {
  return good.map((each) => {
    const place = places[each.id];
    if (!place) return each;
    const [x, y, w, h] = place;
    return { ...each, grid: { x, y, w, h } };
  });
}

describe('the layout mark of a dashboard', () => {
  test('holds every part when the numbers lead and the rows are full', () => {
    const mark = layoutMark({ panels: good, topics: [/orders/, /latency/] });
    expect(mark).toEqual({ gaps: [], firstRow: [], beside: [] });
  });

  test('names each row that leaves columns empty, as the server reads rows', () => {
    const mark = layoutMark({ panels: moved({ 'error-rate': [8, 0, 2, 3] }) });
    expect(mark?.gaps).toEqual(['row y0 leaves columns 11-12 empty']);
    const narrow = layoutMark({ panels: moved({ requests: [2, 3, 6, 8] }) });
    expect(narrow?.gaps).toEqual(['row y3 leaves columns 1-2 and 9-12 empty']);
  });

  test('a tall panel fills the rows it reaches into', () => {
    const panels = specPanels(
      panel('orders', 'stat', [0, 0, 6, 6]),
      panel('revenue', 'stat', [6, 0, 6, 3]),
      panel('failed', 'stat', [6, 3, 6, 3]),
    );
    expect(layoutMark({ panels })?.gaps).toEqual([]);
  });

  test('the first row needs a number when the dashboard has numbers', () => {
    const below = moved({
      requests: [0, 0, 12, 8],
      orders: [0, 8, 4, 3],
      revenue: [4, 8, 4, 3],
      'error-rate': [8, 8, 4, 3],
    });
    expect(layoutMark({ panels: below })?.firstRow).toEqual([
      'the first row has no number: "orders", "revenue", "error-rate" sit below',
    ]);
  });

  test('the first row shows something of what was asked', () => {
    const mark = layoutMark({ panels: good, topics: [/latency/, /p95/] });
    expect(mark?.firstRow).toEqual(['the first row shows none of what was asked']);
    expect(layoutMark({ panels: good, topics: [/latency/, /revenue/] })?.firstRow).toEqual([]);
  });

  test('three panels with no number have no headline, one or two are the answer', () => {
    const charts = specPanels(
      panel('requests', 'time', [0, 0, 12, 8]),
      panel('errors', 'time', [0, 8, 12, 8]),
      panel('latency', 'time', [0, 16, 12, 8]),
    );
    expect(layoutMark({ panels: charts })?.firstRow).toEqual([
      'no headline number on the first row',
    ]);
    expect(layoutMark({ panels: charts.slice(0, 2) })).toEqual({ gaps: [], firstRow: [] });
  });

  test('a number alone on its row is apart from the other numbers', () => {
    const stacked = moved({
      orders: [0, 0, 12, 3],
      revenue: [0, 3, 6, 3],
      'error-rate': [6, 3, 6, 3],
      requests: [0, 6, 12, 8],
      'errors-by-route': [0, 14, 7, 8],
      'errors-table': [7, 14, 5, 8],
    });
    expect(layoutMark({ panels: stacked })?.beside).toEqual([
      '"orders" is a number alone on its row',
    ]);
  });

  test('a chart and a table of the same data belong on one row', () => {
    const apart = moved({ 'errors-by-route': [0, 11, 12, 8], 'errors-table': [0, 19, 12, 8] });
    expect(layoutMark({ panels: apart })?.beside).toEqual([
      '"errors-by-route" and "errors-table" show the same data on different rows',
    ]);
  });

  test('judges side by side only when two panels are related', () => {
    const panels = specPanels(
      panel('orders', 'stat', [0, 0, 12, 3]),
      panel('requests', 'time', [0, 3, 12, 8]),
    );
    const mark = layoutMark({ panels });
    expect(mark).toEqual({ gaps: [], firstRow: [] });
    expect(layoutParts(mark ?? { gaps: [], firstRow: [] }).map((part) => part.label)).toEqual([
      'no gaps',
      'first row',
    ]);
  });

  test('no panel has no mark', () => {
    expect(layoutMark({ panels: [] })).toBeUndefined();
  });
});

describe('the layout mark of a report', () => {
  const headlines = ['orders', 'revenue', 'error-rate'];

  test('the headline numbers are the first row, and the grid is read without them', () => {
    // The headline numbers leave columns of the grid empty, and have a row of their own.
    const panels = moved({
      orders: [0, 0, 3, 3],
      revenue: [3, 0, 3, 3],
      'error-rate': [6, 0, 3, 3],
    });
    const mark = layoutMark({ panels, headlines, topics: [/orders/] });
    expect(mark).toEqual({ gaps: [], firstRow: [], beside: [] });
  });

  test('a report with no headline number does not lead with the answer', () => {
    expect(layoutMark({ panels: good, headlines: [] })?.firstRow).toEqual([
      'no headline numbers lead the report',
    ]);
  });

  test('a number left on the grid is outside the headline row', () => {
    const mark = layoutMark({ panels: good, headlines: ['orders', 'revenue'] });
    expect(mark?.firstRow).toEqual(['"error-rate" is a number outside the headline row']);
    expect(mark?.gaps).toEqual(['row y0 leaves columns 1-8 empty']);
  });

  test('the headline row shows something of what was asked', () => {
    const mark = layoutMark({ panels: good, headlines, topics: [/refunds/] });
    expect(mark?.firstRow).toEqual(['the headline row shows none of what was asked']);
  });
});

/**
 * A dashboard question's outcome.
 *
 * @param id - The question's id.
 * @param panels - The panels of the spec it saved.
 * @param extra - Fields to change.
 * @returns The outcome.
 */
function outcome(id: string, panels: readonly Panel[], extra: Partial<Outcome> = {}): Outcome {
  const built = panelsOf({
    ...dashboardSpecSchema.parse({
      specVersion: 1,
      title: 'Checkout',
      time: { from: 'now-24h', to: 'now' },
      panels: [],
    }),
    panels: [...panels],
  });
  return {
    id,
    built: true,
    panels: built,
    failing: [],
    repairs: 0,
    asked: [],
    turns: 2,
    usage: {},
    durationMs: 1000,
    ...extra,
  };
}

describe('the layout mark of an outcome', () => {
  test('is read from the places the outcome keeps', () => {
    expect(dashboardLayout(outcome('q1', good), [])).toEqual({
      gaps: [],
      firstRow: [],
      beside: [],
    });
  });

  test('is absent when nothing was built, the run failed, or the places were not kept', () => {
    expect(dashboardLayout(outcome('q1', good, { built: false }), [])).toBeUndefined();
    expect(dashboardLayout(outcome('q1', good, { error: 'Unavailable' }), [])).toBeUndefined();
    const kept = outcome('q1', good);
    const before = { ...kept, panels: kept.panels.map(({ grid: _grid, ...rest }) => rest) };
    expect(dashboardLayout(before, [])).toBeUndefined();
  });
});

describe('the layout mark in the report', () => {
  const gapped = moved({ 'error-rate': [8, 0, 2, 3] });
  const report = reportOf([
    outcome('q1', good),
    outcome('q2', gapped),
    outcome('q3', good, { built: false, panels: [] }),
  ]);
  const marks = report.results.map((result) => result.trials[0]?.layout);

  test('stands beside the status and never changes it', () => {
    expect(marks.map((mark) => mark?.gaps)).toEqual([
      [],
      ['row y0 leaves columns 11-12 empty'],
      undefined,
    ]);
    const alone = reportOf([outcome('q2', gapped)]).results[0]?.trials[0];
    const reasons = alone ? reasonsOf(alone) : [];
    expect(reasons.some((reason) => reason.includes('columns'))).toBe(false);
  });

  test('the printed table has a cell per result and the tally', () => {
    expect(marks.map((mark) => layoutCell(mark))).toEqual(['layout 3/3', 'layout 2/3', 'layout -']);
    const tally =
      'Layout: 1 of 2 read well (no gaps 1 of 2, first row 2 of 2, side by side 2 of 2)';
    expect(layoutLine(marks)).toBe(tally);
    expect(summary(report)).toContain(tally);
    expect(layoutLine([undefined])).toBeUndefined();
  });

  test('the Markdown table has a column, with what the layout misses', () => {
    expect(markdownLayout(marks[0])).toBe('✅');
    expect(markdownLayout(marks[1])).toBe('❌ row y0 leaves columns 11-12 empty');
    expect(markdownLayout(undefined)).toBe('');
    const markdown = markdownReport(report);
    expect(markdown).toContain('| Why it fails | Layout |');
    expect(markdown).toContain('| ❌ row y0 leaves columns 11-12 empty |');
  });

  test('the HTML page marks each part, then lists what the layout misses', () => {
    const html = htmlLayout(marks[1]);
    expect(html).toContain('<span class="mark" data-mark="no">no gaps: no</span>');
    expect(html).toContain('<span class="mark" data-mark="yes">first row: yes</span>');
    expect(html).toContain('<li>row y0 leaves columns 11-12 empty</li>');
    expect(htmlLayout(undefined)).toBe('');
    expect(htmlReport(report)).toContain('Layout: 1 of 2 read well');
  });

  test('the table of families has the mark as one', () => {
    const rows = familyRows(reportOf([outcome('f06', good), outcome('f07', gapped)]));
    expect(rows.map((row) => [row.id, row.layout])).toEqual([
      ['f06', 'yes'],
      ['f07', 'no'],
    ]);
    expect(layoutReasons(marks[1] ?? { gaps: [], firstRow: [] })).toHaveLength(1);
  });
});
