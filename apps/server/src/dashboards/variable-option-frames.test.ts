import { expect, test } from 'bun:test';
import type { Frame } from '@quanthea/shared';
import { optionsOfFrames } from './variable-option-frames.ts';

/**
 * A frame of text columns.
 *
 * @param columns - Each column's name and values.
 * @returns The frame.
 */
function frameOf(columns: Record<string, readonly (string | null)[]>): Frame {
  const names = Object.keys(columns);
  const values = names.map((name) => [...(columns[name] ?? [])]);
  return {
    refId: 'options',
    fields: names.map((name) => ({ name, type: 'string' as const })),
    values,
    meta: { rowCount: values[0]?.length ?? 0, truncated: false, durationMs: 1 },
  };
}

test('a source with value and label columns gives labelled options', () => {
  const frame = frameOf({ label: ['Checkout', 'Search', 'api'], value: ['co-1', 'se-2', 'api'] });
  expect(optionsOfFrames([frame])).toEqual([
    { value: 'co-1', label: 'Checkout' },
    { value: 'se-2', label: 'Search' },
    'api',
  ]);
});

test('a source without both columns gives the distinct values of its first text column', () => {
  const frame = frameOf({ service: ['api', 'web', 'api'], label: ['A', 'W', 'A'] });
  expect(optionsOfFrames([frame])).toEqual(['api', 'web']);
});

test('a value without a label stays a plain option, and a repeated value keeps its first label', () => {
  const frame = frameOf({ value: ['a', 'b', 'a'], label: [null, 'Bee', 'Other'] });
  expect(optionsOfFrames([frame])).toEqual(['a', { value: 'b', label: 'Bee' }]);
});

test('a source with no text column gives no options', () => {
  expect(optionsOfFrames([])).toEqual([]);
});
