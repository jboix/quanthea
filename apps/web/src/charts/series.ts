/**
 * Expands the spec's series templates into ECharts series: one per result frame, and per number
 * field when a frame has several. The spec never needs to know how many series come back.
 */
import { createFormatter, type MarkerOutcome } from '@querent/shared';
import { categoryField, type Table } from './tables.ts';
import type { ChartTheme } from './theme.ts';

/** An ECharts object, loosely typed: the spec's JSON plus functions and data from the adapter. */
export type Loose = Record<string, unknown>;

/** Series types that draw one item per row rather than a line of points. */
const itemSeries: ReadonlySet<unknown> = new Set(['pie', 'gauge']);

/**
 * Whether a value is a plain object.
 *
 * @param value - Any value.
 * @returns Whether it is an object that is not an array.
 */
export function isObject(value: unknown): value is Loose {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The series one template draws from one table.
 *
 * @param template - The spec's series.
 * @param table - The table.
 * @param datasetIndex - The ECharts dataset the table became.
 * @param horizontal - Whether categories run along the y axis.
 * @returns The series.
 */
function seriesFor(
  template: Loose,
  table: Table,
  datasetIndex: number,
  horizontal: boolean,
): Loose[] {
  const base = { ...template, datasetIndex };
  if ('encode' in template) return [{ name: table.name, ...base }];
  const category = categoryField(table)?.name;
  const numbers = table.fields.filter(
    (field) => field.type === 'number' && field.name !== category,
  );
  if (itemSeries.has(template.type)) {
    return [{ name: table.name, ...base, encode: { itemName: category, value: numbers[0]?.name } }];
  }
  return numbers.map((field) => ({
    name: numbers.length > 1 ? field.name : table.name,
    ...base,
    encode: horizontal ? { y: category, x: field.name } : { x: category, y: field.name },
  }));
}

/**
 * Expands the templates over the tables of their datasets.
 *
 * @param templates - The spec's `series`, one object or a list.
 * @param groups - The tables of each spec dataset, in order.
 * @param horizontal - Whether categories run along the y axis.
 * @returns The series, with `datasetIndex` pointing at the flattened ECharts datasets.
 */
export function expandSeries(
  templates: unknown,
  groups: readonly (readonly Table[])[],
  horizontal: boolean,
): Loose[] {
  const offsets = groups.map((_group, index) =>
    groups.slice(0, index).reduce((sum, group) => sum + group.length, 0),
  );
  const list = (Array.isArray(templates) ? templates : [templates]).filter(isObject);
  return list.flatMap((template) => {
    const requested = typeof template.datasetIndex === 'number' ? template.datasetIndex : 0;
    const group = Math.min(Math.max(0, requested), groups.length - 1);
    const offset = offsets[group] ?? 0;
    return (groups[group] ?? []).flatMap((table, index) =>
      seriesFor(template, table, offset + index, horizontal),
    );
  });
}

/**
 * Adds the annotation markers to the first series, as dashed vertical lines labelled with their
 * time and text. The labels are drawn on the canvas, never as HTML.
 *
 * @param series - The series.
 * @param markers - The markers of the panel.
 * @param theme - The chart theme.
 * @param timeZone - The time zone of the labels.
 * @returns The series, the first with a `markLine`.
 */
export function withMarkers(
  series: readonly Loose[],
  markers: readonly MarkerOutcome[],
  theme: ChartTheme,
  timeZone: string | undefined,
): Loose[] {
  const [first, ...rest] = series;
  const time = createFormatter({ $fmt: 'datetime', pattern: 'time' }, { timeZone });
  const data = markers.flatMap((marker) =>
    marker.points.map((point) => ({
      xAxis: point.time,
      name: `${time(point.time)} ${point.text}`,
    })),
  );
  if (!first || data.length === 0) return [...series];
  const markLine = {
    symbol: ['none', 'none'],
    silent: true,
    animation: false,
    lineStyle: { color: theme.ink, type: 'dashed', width: 1 },
    label: {
      formatter: '{b}',
      position: 'end',
      color: theme.surface,
      backgroundColor: theme.ink,
      padding: [3, 6],
      borderRadius: 4,
      fontFamily: theme.monoFamily,
      fontSize: 11,
    },
    data,
  };
  return [{ ...first, markLine }, ...rest];
}
