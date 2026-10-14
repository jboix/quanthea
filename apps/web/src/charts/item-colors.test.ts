import { describe, expect, test } from 'bun:test';
import type { Dataset } from '@quanthea/shared';
import { itemPalette, withItemColors } from './item-colors.ts';
import { prepareChart } from './prepare/index.ts';
import { defaultTheme } from './theme.ts';

const platforms: Dataset = {
  dimensions: [
    { name: 'platform', type: 'string' },
    { name: 'sessions', type: 'number' },
  ],
  source: [
    ['iOS', 40],
    ['Web', 90],
    ['Android', 30],
    ['tvOS', 5],
    ['Roku', 2],
  ],
};

const colors = [{ value: 'web', tone: 'series2' as const }];

/**
 * A chart's data prepared as its kind says.
 *
 * @param kind - How.
 * @param limit - The most categories, if any.
 * @returns The prepared data.
 */
function prepared(kind: 'items' | 'ranked', limit?: number) {
  const roles = kind === 'items' ? {} : { x: 'platform', y: 'sessions' };
  return prepareChart(kind, {
    option: { series: [{ type: kind === 'items' ? 'pie' : 'bar' }] },
    datasets: [platforms],
    roles,
    limit,
    format: {},
  });
}

describe('the colour of a value on items', () => {
  test('colours a donut slice by its category, after the sort and the limit, "Other" neutral', () => {
    const palette = itemPalette('items', prepared('items', 3), colors, defaultTheme);
    const { tones, palette: base } = defaultTheme;
    expect(palette).toEqual([tones.series2, base[1] ?? '', tones.neutral]);
  });

  test('colours a ranked bar by its category, the other bars in the series colour', () => {
    const palette = itemPalette('ranked', prepared('ranked'), colors, defaultTheme);
    const first = defaultTheme.palette[0] ?? '';
    expect(palette).toEqual([defaultTheme.tones.series2, first, first, first, first]);
    const option = withItemColors({ series: [{ type: 'bar' }] }, 'ranked', palette);
    expect(option.series).toEqual([{ type: 'bar', colorBy: 'data' }]);
    expect(option.color).toEqual(palette);
  });

  test('changes nothing when no category has a colour', () => {
    const none = [{ value: 'Linux', tone: 'bad' as const }];
    expect(itemPalette('items', prepared('items'), none, defaultTheme)).toBeUndefined();
    expect(itemPalette('cartesian', prepared('items'), colors, defaultTheme)).toBeUndefined();
    expect(withItemColors({ color: ['#000'] }, 'items', undefined)).toEqual({ color: ['#000'] });
  });
});
