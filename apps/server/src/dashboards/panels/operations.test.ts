import { describe, expect, test } from 'bun:test';
import type { Operation } from '@quanthea/shared';
import { completeCharts } from './complete.ts';
import { applyEdit } from './edit.ts';
import { edit, specOf, testOf } from './fixtures.ts';

/**
 * An edit that adds one table of failed and all orders by status, with operations.
 *
 * @param operations - The panel's operations.
 * @returns The edit.
 */
function withOperations(operations: unknown[]) {
  return edit({
    title: 'Orders',
    summary: 'Failure share by status',
    panels: [
      {
        title: 'Failure share',
        data: {
          kind: 'raw',
          connector: 'shop',
          language: 'sql',
          query: 'SELECT status, count(*) AS failed, count(*) AS total FROM orders GROUP BY status',
        },
        operations,
        chart: { recipe: 'table.rows' },
      },
    ],
  });
}

describe('operations in an edit', () => {
  test('are stored on the panel as the agent wrote them', () => {
    const calculate: Operation = {
      op: 'calculate',
      name: 'share',
      fn: 'ratio',
      of: ['failed', 'total'],
    };
    const spec = specOf(undefined, withOperations([calculate]));
    expect(spec.panels[0]?.operations).toEqual([calculate]);
  });

  test('a step that does not fit its form is refused with what is wrong', () => {
    const wrong = { op: 'calculate', name: 'share', fn: 'divide', of: ['failed'] };
    expect(() => applyEdit(undefined, withOperations([wrong]))).toThrow(
      'The operations do not fit their forms:',
    );
    expect(() => applyEdit(undefined, withOperations([{ op: 'melt' }]))).toThrow('op');
  });

  test('no operations, or an empty list, leaves none on the panel', () => {
    expect(specOf(undefined, withOperations([])).panels[0]?.operations).toBeUndefined();
  });

  test('further data requests get refIds B to D, and the view reads the first alone', () => {
    const request = withOperations([
      { op: 'join', with: 'B', on: ['status'], rename: { total: 'all' } },
    ]);
    const [panel] = request.panels;
    const more = [{ kind: 'raw', connector: 'shop', language: 'sql', query: 'SELECT 1 AS status' }];
    const spec = specOf(undefined, { ...request, panels: [{ ...panel, more }] } as never);
    expect(spec.panels[0]?.queries.map((query) => query.refId)).toEqual(['A', 'B']);
    expect(spec.panels[0]?.view).toMatchObject({ kind: 'table', ref: 'A' });
  });

  test('a further request no operation reads, or one that does not fit, is refused', () => {
    const [panel] = withOperations([]).panels;
    const raw = { kind: 'raw', connector: 'shop', language: 'sql', query: 'SELECT 1' };
    const unread = { ...withOperations([]), panels: [{ ...panel, more: [raw] }] };
    expect(() => applyEdit(undefined, unread as never)).toThrow(
      'The data in "more" with refId B is read by no operation: join or append it, or leave it out.',
    );
    const wrong = { ...withOperations([]), panels: [{ ...panel, more: [{ kind: 'sql-stat' }] }] };
    expect(() => applyEdit(undefined, wrong as never)).toThrow('more[0]: raw or saved data,');
  });

  test('a table over a pivot lists the columns not named by data, and shows the rest', () => {
    const pivot = { op: 'pivot', rows: 'status', columns: 'region', value: 'failed' };
    const { spec, charts } = applyEdit(undefined, withOperations([pivot]));
    const run = testOf(
      'failure-share',
      [
        { name: 'status', type: 'string' },
        { name: 'EU', type: 'number' },
        { name: 'US', type: 'number' },
      ],
      [['paid'], [1], [2]],
    );
    const origins = [
      { column: 'status', from: ['A'] },
      { column: 'EU', from: ['A'], nameFromData: true },
      { column: 'US', from: ['A'], nameFromData: true },
    ];
    const [query] = run.run.queries;
    const tests = [{ ...run, run: { ...run.run, queries: [{ ...query, origins }] } }] as never;
    const completed = completeCharts(spec, charts, tests);
    expect(completed.problems.size).toBe(0);
    expect(completed.spec.panels[0]?.view).toEqual({
      kind: 'table',
      ref: 'A',
      columns: [{ field: 'status' }],
      rest: {},
    });
  });
});
