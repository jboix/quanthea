import { describe, expect, test } from 'bun:test';
import type { Mapping } from '@quanthea/shared';
import { withSteps } from './steps.ts';

/** Thresholds of a share: good under 0.7, a warning up to 0.9, bad above. */
const steps: Mapping[] = [
  { match: { to: 0.7 }, tone: 'good' },
  { match: { from: 0.7, to: 0.9 }, tone: 'warning' },
  { match: { from: 0.9 }, tone: 'bad' },
];

/** A gauge with a progress bar over a rounded track, from 0 to 1. */
const bar = {
  type: 'gauge',
  min: 0,
  max: 1,
  progress: { show: true, width: 12, roundCap: true },
  axisLine: { roundCap: true, lineStyle: { width: 12, color: [[1, '@divider']] } },
};

/** The same gauge with a needle and no bar. */
const dial = { ...bar, progress: { show: false }, pointer: { show: true } };

/**
 * The colour stops of a stepped series.
 *
 * @param series - The series, as `withSteps` returned it.
 * @returns The stops of its dial.
 */
function stopsOf(series: Record<string, unknown>): unknown {
  return (series.axisLine as { lineStyle: { color: unknown } }).lineStyle.color;
}

describe('the steps of a gauge', () => {
  test('tint the track, and the bar takes the tone of its value, both with flat ends', () => {
    const stepped = withSteps(bar, steps, 0.72);
    expect(stopsOf(stepped)).toEqual([
      [0.7, '@toneSoft.good'],
      [0.9, '@toneSoft.warning'],
      [1, '@toneSoft.bad'],
    ]);
    expect(stepped.axisLine).toMatchObject({ roundCap: false, lineStyle: { width: 12 } });
    expect(stepped.progress).toEqual({
      show: true,
      width: 12,
      roundCap: false,
      itemStyle: { color: '@tone.warning' },
    });
  });

  test('colour the dial of a needle in their tones, and leave the bar off', () => {
    const stepped = withSteps(dial, steps, 0.95);
    expect(stopsOf(stepped)).toEqual([
      [0.7, '@tone.good'],
      [0.9, '@tone.warning'],
      [1, '@tone.bad'],
    ]);
    expect(stepped.progress).toEqual({ show: false });
  });

  test('are placed between the min and the max, in the unit of the value', () => {
    const latency = { ...dial, min: 100, max: 500 };
    const millis: Mapping[] = [
      { match: { from: 200, to: 300 }, tone: 'warning' },
      { match: { from: 300 }, tone: 'bad' },
      { match: { from: 900 }, tone: 'series3' },
    ];
    expect(stopsOf(withSteps(latency, millis, 250))).toEqual([
      [0.25, '@divider'],
      [0.5, '@tone.warning'],
      [1, '@tone.bad'],
    ]);
    const { max: _max, ...percent } = dial;
    expect(stopsOf(withSteps(percent, [{ match: { from: 80 }, tone: 'bad' }], 10))).toEqual([
      [0.8, '@divider'],
      [1, '@tone.bad'],
    ]);
  });

  test('give a stretch to the first step that holds it, as a value there would take', () => {
    const overlapping: Mapping[] = [
      { match: { from: 0.5 }, tone: 'bad' },
      { match: { from: 0.2 }, tone: 'warning' },
    ];
    expect(stopsOf(withSteps(dial, overlapping, null))).toEqual([
      [0.2, '@divider'],
      [0.5, '@tone.warning'],
      [1, '@tone.bad'],
    ]);
  });

  test('leave the bar its colour when no step holds the value or there is none', () => {
    const high: Mapping[] = [{ match: { from: 0.9 }, tone: 'bad' }];
    expect(withSteps(bar, high, 0.4).progress).toEqual({ show: true, width: 12, roundCap: false });
    expect(withSteps(bar, steps, null).progress).not.toHaveProperty('itemStyle');
  });

  test('leave a gauge as it is without a step, or with a dial of no length', () => {
    expect(withSteps(bar, undefined, 0.5)).toBe(bar);
    expect(withSteps(bar, [{ match: { value: 1 }, tone: 'bad' }], 0.5)).toBe(bar);
    expect(withSteps({ ...bar, max: 0 }, steps, 0.5)).toMatchObject({
      max: 0,
      axisLine: bar.axisLine,
    });
  });
});
