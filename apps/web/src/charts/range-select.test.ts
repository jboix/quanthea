import { expect, test } from 'bun:test';
import { selectedStretch, selectsTime } from './range-select.tsx';

/** One millisecond a pixel, from the epoch. */
const timeAt = (x: number) => x * 1000;

test('a drag selects its stretch, earliest first, whichever way it went', () => {
  expect(selectedStretch(100, 40, timeAt)).toEqual([40_000, 100_000]);
  expect(selectedStretch(40, 100, timeAt)).toEqual([40_000, 100_000]);
});

test('a drag narrower than a few pixels is a click and selects nothing', () => {
  expect(selectedStretch(40, 45, timeAt)).toBeUndefined();
});

test('a stretch off the axis selects nothing', () => {
  expect(selectedStretch(0, 50, () => Number.NaN)).toBeUndefined();
});

test('a chart selects time when its x axis is time and it has no zoom of its own', () => {
  expect(selectsTime({ xAxis: { type: 'time' } })).toBe(true);
  expect(selectsTime({ xAxis: [{ type: 'time' }] })).toBe(true);
  expect(selectsTime({ xAxis: { type: 'category' } })).toBe(false);
  expect(selectsTime({ xAxis: { type: 'time' }, dataZoom: [{ type: 'inside' }] })).toBe(false);
  expect(selectsTime({ series: [{ type: 'pie' }] })).toBe(false);
});
