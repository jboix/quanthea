import { describe, expect, test } from 'bun:test';
import type { Frame } from '@quanthea/plugin-kit/contract';
import type { QueryOutcome } from '../api/panels.ts';
import type { Panel } from '../spec/dashboard.ts';
import { withOperations } from './operations-outcome.ts';

const frame: Frame = {
  refId: 'A',
  fields: [
    { name: 'errors', type: 'number' },
    { name: 'sessions', type: 'number', unit: 'short' },
  ],
  values: [
    [3, 4],
    [100, 0],
  ],
  meta: { rowCount: 2, truncated: true, durationMs: 12 },
};

const panel = {
  id: 'rate',
  title: 'Error rate',
  grid: { x: 0, y: 0, w: 6, h: 4 },
  queries: [],
  view: { kind: 'stat', ref: 'A', reduce: 'last', format: { kind: 'number' } },
  operations: [{ op: 'calculate', name: 'rate', fn: 'ratio', of: ['errors', 'sessions'] }],
} as unknown as Panel;

const other: QueryOutcome = { refId: 'B', frames: [], error: null };

describe('the operations step of a panel run', () => {
  test("the first query's frames become the operations' table", () => {
    const [first, second] = withOperations(panel, [
      { refId: 'A', frames: [frame], error: null },
      other,
    ]);
    expect(first?.error).toBeNull();
    expect(first?.frames).toEqual([
      {
        refId: 'A',
        fields: [
          { name: 'errors', type: 'number' },
          { name: 'sessions', type: 'number', unit: 'short' },
          { name: 'rate', type: 'number' },
        ],
        values: [
          [3, 4],
          [100, 0],
          [0.03, 0],
        ],
        meta: { rowCount: 2, truncated: true, durationMs: 12 },
      },
    ]);
    expect(second).toEqual(other);
  });

  test('a step that cannot run fails the first query with its message', () => {
    const wrong = { ...panel, operations: [{ ...panel.operations?.[0], of: ['errors', 'plays'] }] };
    const [first] = withOperations(wrong as Panel, [{ refId: 'A', frames: [frame], error: null }]);
    expect(first).toEqual({
      refId: 'A',
      frames: [],
      error: {
        code: 'invalid',
        message: 'operations[0] (calculate): no column "plays" (columns: errors, sessions).',
      },
    });
  });

  test('a failed first query, or a panel without operations, keeps its outcomes', () => {
    const failed: QueryOutcome = {
      refId: 'A',
      frames: [],
      error: { code: 'timeout', message: 'Timed out.' },
    };
    expect(withOperations(panel, [failed])).toEqual([failed]);
    const plain = { ...panel, operations: undefined } as Panel;
    const outcome = { refId: 'A', frames: [frame], error: null };
    expect(withOperations(plain, [outcome])).toEqual([outcome]);
  });

  test('a query a join reads that failed fails the first query too, saying so', () => {
    const joined = {
      ...panel,
      operations: [{ op: 'join', with: 'B', on: ['errors'], how: 'outer' }],
    } as unknown as Panel;
    const failedB: QueryOutcome = {
      refId: 'B',
      frames: [],
      error: { code: 'timeout', message: 'Timed out.' },
    };
    const [first, second] = withOperations(joined, [
      { refId: 'A', frames: [frame], error: null },
      failedB,
    ]);
    expect(first?.error).toEqual({
      code: 'invalid',
      message: 'the operations read B, which failed',
    });
    expect(second).toEqual(failedB);
  });

  test("a join reads the other query's table", () => {
    const other: Frame = {
      ...frame,
      refId: 'B',
      fields: [
        { name: 'errors', type: 'number' },
        { name: 'plays', type: 'number' },
      ],
      values: [[3], [50]],
    };
    const joined = {
      ...panel,
      operations: [{ op: 'join', with: 'B', on: ['errors'], how: 'inner' }],
    } as unknown as Panel;
    const [first] = withOperations(joined, [
      { refId: 'A', frames: [frame], error: null },
      { refId: 'B', frames: [other], error: null },
    ]);
    expect(first?.frames[0]?.values).toEqual([[3], [100], [50]]);
    expect(first?.origins?.map((origin) => origin.from)).toEqual([['A'], ['A'], ['B']]);
  });
});
