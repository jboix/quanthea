/**
 * The dashboard's colour per value on charts that colour their items: a donut's or a funnel's
 * slices, and a ranked bar chart's bars, by category. The colours follow the rows as prepared,
 * after the limit and the "Other" tail.
 */
import type { PrepareKind, ValueColor } from '@quanthea/shared';
import type { Loose } from './loose.ts';
import type { Prepared } from './prepare/index.ts';
import { allColumns, xColumn } from './roles.ts';
import type { ChartTheme } from './theme.ts';
import { colorLookup } from './value-colors.ts';

/** The name `items` gives the sum of the categories past the limit. */
const otherName = 'Other';

/**
 * The categories of a prepared chart, in the order of its items.
 *
 * @param kind - How the chart was prepared.
 * @param prepared - The prepared data.
 * @returns The categories; none for a chart that does not colour its items.
 */
function categoriesOf(kind: PrepareKind, prepared: Prepared): unknown[] {
  const [main] = prepared.datasets;
  if (!main) return [];
  if (kind === 'items') return main.source.map((row) => row[0]);
  if (kind !== 'ranked' || allColumns(prepared.roles, 'y').length > 1) return [];
  const at = main.dimensions.findIndex((column) => column.name === xColumn(prepared.roles, main));
  return at < 0 ? [] : main.source.map((row) => row[at]);
}

/**
 * The palette of a chart whose items take the dashboard's colours: each item's colour in order.
 * A slice keeps its palette place, a ranked bar the series colour, and "Other" is neutral.
 *
 * @param kind - How the chart was prepared.
 * @param prepared - The prepared data.
 * @param colors - The dashboard's colours, if any.
 * @param theme - The theme.
 * @returns The colours; none when no item has a colour of its own.
 */
export function itemPalette(
  kind: PrepareKind,
  prepared: Prepared,
  colors: readonly ValueColor[] | undefined,
  theme: ChartTheme,
): string[] | undefined {
  if (!colors || colors.length === 0) return undefined;
  const colorOf = colorLookup(colors, theme);
  const categories = categoriesOf(kind, prepared);
  if (!categories.some((category) => colorOf(category) !== undefined)) return undefined;
  const { palette } = theme;
  return categories.map((category, index) => {
    const own = colorOf(category);
    if (own !== undefined) return own;
    if (category === otherName) return theme.tones.neutral;
    return kind === 'items' ? (palette[index % palette.length] ?? '') : (palette[0] ?? '');
  });
}

/**
 * The option with its items in the dashboard's colours: the palette set item by item, and a ranked
 * bar chart's series coloured by item.
 *
 * @param option - The built option.
 * @param kind - How the chart was prepared.
 * @param palette - The colours of its items, if any.
 * @returns The option.
 */
export function withItemColors(
  option: Loose,
  kind: PrepareKind,
  palette: readonly string[] | undefined,
): Loose {
  if (!palette) return option;
  const series = Array.isArray(option.series) ? (option.series as Loose[]) : [];
  const byItem =
    kind === 'ranked' ? series.map((each) => ({ ...each, colorBy: 'data' })) : option.series;
  return { ...option, color: [...palette], series: byItem };
}
