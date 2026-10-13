import { describe, expect, test } from 'bun:test';
import type { DashboardSpec, PanelRun } from '@quanthea/shared';
import { panelResults } from './panel-results.ts';

/** A frame of a query's result. */
type Frame = PanelRun['queries'][number]['frames'][number];

/**
 * A frame from its columns.
 *
 * @param fields - Each column's name and type, with the labels of a series' value.
 * @param values - Each column's values.
 * @returns The frame.
 */
function frame(
  fields: readonly { name: string; type: string; labels?: Record<string, string> }[],
  values: readonly (readonly unknown[])[],
): Frame {
  const rowCount = values[0]?.length ?? 0;
  return { refId: 'A', fields, values, meta: { rowCount } } as unknown as Frame;
}

/**
 * A panel's run of one query.
 *
 * @param frames - The query's frames.
 * @returns The run.
 */
function run(frames: readonly Frame[]): PanelRun {
  const queries = [{ refId: 'A', frames: [...frames], error: null }];
  return { time: { from: 0, to: 1 }, queries, markers: [], durationMs: 1 };
}

/**
 * A spec with one panel of a view.
 *
 * @param view - The panel's view.
 * @returns The spec.
 */
function specOf(view: object): DashboardSpec {
  return { panels: [{ id: 'p', title: 'P', queries: [], view }] } as unknown as DashboardSpec;
}

const chart = { kind: 'chart' };
const stat = { kind: 'stat', ref: 'A', reduce: 'last' };

describe('what a panel returned, kept small', () => {
  test('a stat keeps the number it shows, as its view reduces the result', () => {
    const tests = [
      { panelId: 'p', run: run([frame([{ name: 'value', type: 'number' }], [[312]])]) },
    ];
    const [result] = panelResults(specOf(stat), tests);
    expect(result?.shown).toBe(312);
    expect(result?.queries[0]).toMatchObject({ rowCount: 1, rows: [[312]], truncated: false });
    expect(panelResults(specOf(chart), tests)[0]).not.toHaveProperty('shown');
  });

  test('a number column keeps its count, its total, its range and when it was highest', () => {
    const fields = [
      { name: 'time', type: 'time' },
      { name: 'count', type: 'number' },
    ];
    const frames = [
      frame(fields, [
        [1000, 2000, 3000],
        [5, 40, null],
      ]),
    ];
    const [result] = panelResults(specOf(chart), [{ panelId: 'p', run: run(frames) }]);
    expect(result?.queries[0]?.columns).toEqual([
      { name: 'time', type: 'time' },
      { name: 'count', type: 'number', count: 2, sum: 45, min: 5, max: 40, maxAt: 2000 },
    ]);
  });

  test('a breakdown keeps a total per value of its one text column', () => {
    const fields = [
      { name: 'platform', type: 'string' },
      { name: 'count', type: 'number' },
    ];
    const frames = [
      frame(fields, [
        ['Web', 'Apple'],
        [2132, 1356],
      ]),
    ];
    const [result] = panelResults(specOf(chart), [{ panelId: 'p', run: run(frames) }]);
    expect(result?.queries[0]?.totals).toEqual({ Web: 2132, Apple: 1356 });
  });

  test('series stacked into a long table keep a total per series, over time', () => {
    const series = (service: string, values: number[]) =>
      frame(
        [
          { name: 'time', type: 'time' },
          { name: 'Value', type: 'number', labels: { service } },
        ],
        [[1000, 2000], values],
      );
    const frames = [series('checkout-svc', [3, 4]), series('search-svc', [10, 20])];
    const [result] = panelResults(specOf(chart), [{ panelId: 'p', run: run(frames) }]);
    expect(result?.queries[0]?.totals).toEqual({ 'checkout-svc': 7, 'search-svc': 30 });
    expect(result?.queries[0]?.rowCount).toBe(4);
  });

  test('a result with several text columns and no series has no total per group', () => {
    const fields = [
      { name: 'browser', type: 'string' },
      { name: 'os', type: 'string' },
      { name: 'count', type: 'number' },
    ];
    const frames = [frame(fields, [['Chrome'], ['macOS'], [9]])];
    const [result] = panelResults(specOf(chart), [{ panelId: 'p', run: run(frames) }]);
    expect(result?.queries[0]).not.toHaveProperty('totals');
  });

  test('a long result keeps its first rows and says there are more', () => {
    const values = Array.from({ length: 100 }, (_each, index) => index);
    const frames = [frame([{ name: 'n', type: 'number' }], [values])];
    const [result] = panelResults(specOf(chart), [{ panelId: 'p', run: run(frames) }]);
    expect(result?.queries[0]).toMatchObject({ rowCount: 100, truncated: true });
    expect(result?.queries[0]?.rows).toHaveLength(40);
    expect(result?.queries[0]?.columns[0]).toMatchObject({ count: 100, sum: 4950 });
  });

  test('a query that failed keeps why, and a panel the spec lacks is left out', () => {
    const error = { code: 'connector' as const, message: 'no such index' };
    const failed = { ...run([]), queries: [{ refId: 'A', frames: [], error }] };
    const [result] = panelResults(specOf(chart), [{ panelId: 'p', run: failed }]);
    expect(result?.queries[0]).toMatchObject({ error: 'no such index', rowCount: 0 });
    expect(panelResults(specOf(chart), [{ panelId: 'gone', run: run([]) }])).toEqual([]);
  });
});
