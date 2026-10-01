import { describe, expect, test } from 'bun:test';
import { frameProblems } from '@quanthea/shared';
import { createFrameBuilder } from './frame-builder.ts';

/**
 * Builds a frame from rows with a row limit, stopping when the builder says so.
 *
 * @param rows - The rows to add.
 * @param maxRows - The row limit.
 * @returns The frame and how many rows were offered before the builder stopped.
 */
function build(rows: unknown[][], maxRows: number) {
  const builder = createFrameBuilder({
    refId: 'A',
    fields: [
      { name: 'service', type: 'string' },
      { name: 'errors', type: 'number' },
    ],
    maxRows,
  });
  const offered = rows.findIndex((row) => !builder.add(row));
  return { frame: builder.build(12.4), offered: offered === -1 ? rows.length : offered + 1 };
}

describe('createFrameBuilder', () => {
  test('lays rows out in columns, filling missing values with null', () => {
    const { frame } = build([['checkout-svc', 3], ['cart-svc']], 10);
    expect(frameProblems(frame)).toEqual([]);
    expect(frame.values).toEqual([
      ['checkout-svc', 'cart-svc'],
      [3, null],
    ]);
    expect(frame.meta).toEqual({ rowCount: 2, truncated: false, durationMs: 12 });
  });

  test('drops the row past the limit, marks the frame truncated and says stop', () => {
    const { frame, offered } = build(
      [
        ['a', 1],
        ['b', 2],
        ['c', 3],
        ['d', 4],
      ],
      2,
    );
    expect(offered).toBe(3);
    expect(frame.meta.rowCount).toBe(2);
    expect(frame.meta.truncated).toBe(true);
  });

  test('is not truncated when the rows fit exactly', () => {
    expect(
      build(
        [
          ['a', 1],
          ['b', 2],
        ],
        2,
      ).frame.meta.truncated,
    ).toBe(false);
  });
});
