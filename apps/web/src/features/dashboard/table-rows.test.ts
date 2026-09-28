import { describe, expect, test } from 'bun:test';
import type { Frame, TableView } from '@querent/shared';
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
        { key: '0', cells: ['POST /checkout/confirm', '2.9 s'] },
        { key: '1', cells: ['GET /cart', '640 ms'] },
        { key: '2', cells: ['GET /orders/:id', '410 ms'] },
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
    expect(limited.rows).toEqual([{ key: '0', cells: ['GET /cart', '700 ms'] }]);
    expect(limited.truncated).toBe(true);
  });
});
