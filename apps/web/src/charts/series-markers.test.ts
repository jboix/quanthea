import { describe, expect, test } from 'bun:test';
import type { MarkerOutcome } from '@quanthea/shared';
import { withMarkers } from './series.ts';
import { defaultTheme } from './theme.ts';

/**
 * A set of markers at the given times.
 *
 * @param times - The markers' times, in milliseconds.
 * @returns The set.
 */
function deploys(times: readonly number[]): MarkerOutcome {
  const points = times.map((time) => ({ time, text: `at ${time}` }));
  return { annotation: 'deploys', label: 'deploy', color: '@ink', points, error: null };
}

/**
 * The label alignments of the first series' marker lines.
 *
 * @param markers - The sets.
 * @returns Each line's alignment, in the order of the data.
 */
function aligns(markers: readonly MarkerOutcome[]): unknown[] {
  const [first] = withMarkers([{ type: 'line' }], markers, defaultTheme, 'UTC');
  const markLine = first?.markLine as { data: { label: { align?: string } }[] } | undefined;
  return (markLine?.data ?? []).map((item) => item.label.align);
}

describe('marker labels', () => {
  test('keep a lone marker centred', () => {
    expect(aligns([deploys([1000])])).toEqual([undefined]);
  });

  test('alternate sides in time order, whatever order the sets come in', () => {
    expect(aligns([deploys([3000, 1000]), deploys([2000])])).toEqual(['right', 'right', 'left']);
  });
});
