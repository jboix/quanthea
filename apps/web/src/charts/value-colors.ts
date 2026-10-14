/**
 * The dashboard's colour per value: a series named after a value takes the value's tone, on every
 * chart of the dashboard, in both schemes. Other series keep their place in the palette.
 */
import type { ValueColor } from '@quanthea/shared';
import { isObject, type Loose } from './loose.ts';
import type { ChartTheme } from './theme.ts';

/** The series types drawn on axes, which name a series after a value. */
const seriesTypes: ReadonlySet<unknown> = new Set(['line', 'bar', 'scatter']);

/**
 * The colour of a value, read in any case.
 *
 * @param colors - The dashboard's colours.
 * @param theme - The theme, for each tone's colour.
 * @returns A lookup by name; none for a name no colour has.
 */
export function colorLookup(
  colors: readonly ValueColor[],
  theme: ChartTheme,
): (name: unknown) => string | undefined {
  const byValue = new Map<string, string>();
  for (const { value, tone } of colors) {
    const key = value.trim().toLowerCase();
    if (!byValue.has(key)) byValue.set(key, theme.tones[tone]);
  }
  return (name) => (typeof name === 'string' ? byValue.get(name.trim().toLowerCase()) : undefined);
}

/**
 * The series with the dashboard's colours: a line, bar or scatter series named after a value
 * takes its tone. ECharts gives the other series the palette by their place, so they keep theirs.
 *
 * @param series - The expanded series.
 * @param colors - The dashboard's colours, if any.
 * @param theme - The theme.
 * @returns The series, coloured where a value names one.
 */
export function withValueColors(
  series: readonly Loose[],
  colors: readonly ValueColor[] | undefined,
  theme: ChartTheme,
): Loose[] {
  if (!colors || colors.length === 0) return [...series];
  const colorOf = colorLookup(colors, theme);
  return series.map((each) => {
    const color = seriesTypes.has(each.type) ? colorOf(each.name) : undefined;
    if (color === undefined) return each;
    const itemStyle = isObject(each.itemStyle) ? each.itemStyle : {};
    return { ...each, itemStyle: { ...itemStyle, color } };
  });
}
