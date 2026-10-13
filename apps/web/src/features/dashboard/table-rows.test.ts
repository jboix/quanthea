import { describe, expect, test } from 'bun:test';
import type { Frame, TableView } from '@quanthea/shared';
import { tableRows } from './table-rows.ts';

const instant: Frame = {
  refId: 'A',
  fields: [
    { name: 'route', type: 'string' },
    { name: 'Value', type: 'number' },
  ],
  values: [
    ['GET /cart', 'POST /checkout/confirm', 'GET /orders/:id'],
    [0.64, 2.9, 0.41],
  ],
  meta: { rowCount: 3, truncated: false, durationMs: 1 },
};

const view: TableView = {
  kind: 'table',
  ref: 'A',
  columns: [
    { field: 'route', label: 'Endpoint' },
    { field: 'Value', label: 'p95', format: { $fmt: 'duration', unit: 's' }, align: 'right' },
  ],
  sort: { field: 'Value', dir: 'desc' },
};

describe('tableRows', () => {
  test('formats, sorts and labels the columns', () => {
    expect(tableRows(view, [{ refId: 'A', frames: [instant], error: null }])).toEqual({
      columns: [
        { label: 'Endpoint', align: 'left' },
        { label: 'p95', align: 'right' },
      ],
      rows: [
        {
          key: '1',
          cells: [
            { value: 'POST /checkout/confirm', text: 'POST /checkout/confirm' },
            { value: 2.9, text: '2.9 s' },
          ],
        },
        {
          key: '0',
          cells: [
            { value: 'GET /cart', text: 'GET /cart' },
            { value: 0.64, text: '640 ms' },
          ],
        },
        {
          key: '2',
          cells: [
            { value: 'GET /orders/:id', text: 'GET /orders/:id' },
            { value: 0.41, text: '410 ms' },
          ],
        },
      ],
      truncated: false,
    });
  });

  test('reads series labels as columns and cuts at the limit', () => {
    const series: Frame = {
      refId: 'A',
      fields: [
        { name: 'Time', type: 'time' },
        { name: 'Value', type: 'number', labels: { route: 'GET /cart' } },
      ],
      values: [
        [1, 2],
        [0.5, 0.7],
      ],
      meta: { rowCount: 2, truncated: false, durationMs: 1 },
    };
    const limited = tableRows({ ...view, limit: 1 }, [
      { refId: 'A', frames: [series], error: null },
    ]);
    expect(limited.rows).toEqual([
      {
        key: '1',
        cells: [
          { value: 'GET /cart', text: 'GET /cart' },
          { value: 0.7, text: '700 ms' },
        ],
      },
    ]);
    expect(limited.truncated).toBe(true);
  });

  test('a row keeps its key whichever way the rows are sorted', () => {
    const outcomes = [{ refId: 'A', frames: [instant], error: null }];
    const keysByRoute = (dir: 'asc' | 'desc' | undefined) => {
      const sorted = dir
        ? { ...view, sort: { field: 'Value', dir } }
        : { ...view, sort: undefined };
      const { rows } = tableRows(sorted, outcomes);
      return Object.fromEntries(rows.map((row) => [row.cells[0]?.value, row.key]));
    };
    const unsorted = keysByRoute(undefined);
    expect(unsorted).toEqual({
      'GET /cart': '0',
      'POST /checkout/confirm': '1',
      'GET /orders/:id': '2',
    });
    expect(keysByRoute('asc')).toEqual(unsorted);
    expect(keysByRoute('desc')).toEqual(unsorted);
  });

  test('a mapped cell takes the mapping text and skips the format', () => {
    const mapped: TableView = {
      kind: 'table',
      ref: 'A',
      columns: [
        { field: 'route', mappings: [{ match: { value: 'GET /cart' }, text: 'Cart' }] },
        {
          field: 'Value',
          format: { $fmt: 'duration', unit: 's' },
          toneAs: 'background',
          mappings: [
            { match: { to: 0.5 }, tone: 'good' },
            { match: { from: 0.5, to: 1 }, text: 'slowing', tone: 'warning' },
            { match: { from: 1 }, tone: 'bad' },
          ],
        },
      ],
    };
    const table = tableRows(mapped, [{ refId: 'A', frames: [instant], error: null }]);
    expect(table.columns.map((column) => column.toneAs)).toEqual([undefined, 'background']);
    expect(table.rows.map((row) => row.cells)).toEqual([
      [
        { value: 'GET /cart', text: 'Cart' },
        { value: 0.64, text: 'slowing', tone: 'warning' },
      ],
      [
        { value: 'POST /checkout/confirm', text: 'POST /checkout/confirm' },
        { value: 2.9, text: '2.9 s', tone: 'bad' },
      ],
      [
        { value: 'GET /orders/:id', text: 'GET /orders/:id' },
        { value: 0.41, text: '410 ms', tone: 'good' },
      ],
    ]);
  });

  test('a mapping of no value gives a missing cell its text, and sorting reads the raw value', () => {
    const mappings = [{ match: { null: true as const }, text: 'none', tone: 'neutral' as const }];
    const missing: TableView = {
      kind: 'table',
      ref: 'A',
      columns: [
        { field: 'absent', mappings },
        { field: 'Value', mappings: [{ match: { from: 0 }, text: 'a number' }] },
      ],
      sort: { field: 'Value', dir: 'asc' },
      limit: 1,
    };
    const { rows } = tableRows(missing, [{ refId: 'A', frames: [instant], error: null }]);
    expect(rows.map((row) => row.cells)).toEqual([
      [
        { value: null, text: 'none', tone: 'neutral' },
        { value: 0.41, text: 'a number' },
      ],
    ]);
  });

  test('a column the result lacks reads null with an empty text', () => {
    const missing: TableView = { kind: 'table', ref: 'A', columns: [{ field: 'absent' }] };
    const { rows } = tableRows(missing, [{ refId: 'A', frames: [instant], error: null }]);
    expect(rows.map((row) => row.cells)).toEqual([
      [{ value: null, text: '' }],
      [{ value: null, text: '' }],
      [{ value: null, text: '' }],
    ]);
  });
});
