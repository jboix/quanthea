import { expect, test } from 'bun:test';
import type { Panel, QueryOutcome } from '@quanthea/shared';
import { cutAtRowLimit } from './row-limit.ts';

/**
 * A query's outcome of one frame.
 *
 * @param truncated - Whether the source cut it at the row limit.
 * @returns The outcome.
 */
function outcome(truncated: boolean): QueryOutcome {
  const meta = { rowCount: 2, truncated, durationMs: 1 };
  const frame = {
    refId: 'A',
    fields: [{ name: 'n', type: 'number' as const }],
    values: [[1, 2]],
    meta,
  };
  return { refId: 'A', frames: [frame], error: null };
}

/**
 * A panel of a kind.
 *
 * @param kind - The kind of its view.
 * @returns The panel, as far as the check reads it.
 */
function panel(kind: Panel['view']['kind']): Panel {
  return { view: { kind } } as Panel;
}

test('a chart says so when one of its results was cut at the row limit', () => {
  expect(cutAtRowLimit(panel('chart'), [outcome(false), outcome(true)])).toBe(true);
  expect(cutAtRowLimit(panel('chart'), [outcome(false)])).toBe(false);
  expect(cutAtRowLimit(panel('chart'), [])).toBe(false);
});

test('a table and a stat keep their own words', () => {
  expect(cutAtRowLimit(panel('table'), [outcome(true)])).toBe(false);
  expect(cutAtRowLimit(panel('stat'), [outcome(true)])).toBe(false);
});
