import { describe, expect, test } from 'bun:test';
import type { Dataset } from '@quanthea/shared';
import { legendValue, withLegendValues } from './legend-values.ts';

const wide: Dataset = {
  dimensions: [
    { name: 'time', type: 'time' },
    { name: 'web', type: 'number' },
    { name: 'ios', type: 'number' },
  ],
  source: [
    [1, 10, 4],
    [2, null, 6],
    [3, 30, null],
  ],
};

/**
 * A line chart's option over the wide dataset, its value axis writing seconds.
 *
 * @param legend - Its legend, if any.
 * @returns The option.
 */
function option(legend?: object) {
  return {
    yAxis: { type: 'value', axisLabel: { formatter: (value: number) => `${value} s` } },
    series: [
      { type: 'line', name: 'web', encode: { x: 'time', y: 'web' } },
      { type: 'line', name: 'ios', encode: { x: 'time', y: 'ios' } },
    ],
    ...(legend ? { legend } : {}),
  };
}

describe('a value per series in the legend', () => {
  test('is the total, the mean, the last or the highest, missing values skipped', () => {
    const web = [10, null, 30];
    expect(legendValue(web, 'total')).toBe(40);
    expect(legendValue(web, 'mean')).toBe(20);
    expect(legendValue(web, 'last')).toBe(30);
    expect(legendValue(web, 'max')).toBe(30);
    expect(legendValue([null], 'total')).toBeUndefined();
  });

  test('follows each name, written as the value axis writes it', () => {
    const drawn = withLegendValues(option({ top: 0 }), 'mean', [wide]);
    const formatter = (drawn.legend as { formatter: (name: string) => string }).formatter;
    expect(formatter('web')).toBe('web  20 s');
    expect(formatter('ios')).toBe('ios  5 s');
    expect(formatter('other')).toBe('other');
  });

  test('is left out of a chart without a legend, and when the view asks for none', () => {
    expect(withLegendValues(option(), 'total', [wide]).legend).toBeUndefined();
    const plain = option({ top: 0 });
    expect(withLegendValues(plain, undefined, [wide])).toBe(plain);
  });
});
