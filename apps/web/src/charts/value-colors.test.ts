import { describe, expect, test } from 'bun:test';
import { defaultTheme } from './theme.ts';
import { withValueColors } from './value-colors.ts';

const colors = [
  { value: 'Web', tone: 'series3' },
  { value: 'error', tone: 'bad' },
  { value: 'web', tone: 'series1' },
] as const;

describe('the colour of a value', () => {
  test('goes to a series named after the value, in any case, the first colour winning', () => {
    const series = withValueColors(
      [
        { type: 'line', name: 'web', itemStyle: { opacity: 0.8 } },
        { type: 'bar', name: 'ERROR' },
      ],
      colors,
      defaultTheme,
    );
    expect(series[0]?.itemStyle).toEqual({ opacity: 0.8, color: defaultTheme.tones.series3 });
    expect(series[1]?.itemStyle).toEqual({ color: defaultTheme.tones.bad });
  });

  test('leaves the other series to the palette, by their place', () => {
    const series = withValueColors(
      [
        { type: 'line', name: 'iOS' },
        { type: 'line', name: 'Web' },
        { type: 'line', name: 'tvOS' },
      ],
      colors,
      defaultTheme,
    );
    expect(series[0]).toEqual({ type: 'line', name: 'iOS' });
    expect(series[2]).toEqual({ type: 'line', name: 'tvOS' });
  });

  test('colours no series of another kind, and nothing without colours', () => {
    const pie = [{ type: 'pie', name: 'Web' }];
    expect(withValueColors(pie, colors, defaultTheme)).toEqual(pie);
    expect(withValueColors([{ type: 'line', name: 'Web' }], undefined, defaultTheme)).toEqual([
      { type: 'line', name: 'Web' },
    ]);
  });
});
