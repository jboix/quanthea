/**
 * Preparations that place single values: days on a calendar, the last value on a dial or as a big
 * number, values per region on a map, and values at latitude and longitude.
 */
import { columnIndex, columnValues, createFormatter, namedFormatterSchema } from '@querent/shared';
import type { Loose } from '../loose.ts';
import { oneColumn, xColumn } from '../roles.ts';
import { cartesian } from './cartesian.ts';
import { type Prepared, type PrepareInput, withFirstSeries, withVisualRange } from './types.ts';

/**
 * A day as ECharts calendars name it.
 *
 * @param time - Epoch milliseconds.
 * @returns Such as `2026-01-05`, in UTC.
 */
function dayOf(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

/**
 * Daily values on a calendar whose range follows the data.
 *
 * @param input - The option, datasets and roles.
 * @returns The prepared option.
 */
export function calendar(input: PrepareInput): Prepared {
  const [dataset] = input.datasets;
  const [time, value] = [
    oneColumn(input.roles, 'time') ?? '',
    oneColumn(input.roles, 'value') ?? '',
  ];
  const rows = dataset
    ? dataset.source.map(
        (row) => [row[columnIndex(dataset, time)], row[columnIndex(dataset, value)]] as const,
      )
    : [];
  const days = rows
    .filter(([day]) => typeof day === 'number')
    .map(([day, amount]) => [dayOf(day as number), amount]);
  const range =
    days.length === 0 ? dayOf(Date.now()).slice(0, 7) : [days[0]?.[0], days.at(-1)?.[0]];
  const option = withVisualRange(
    withFirstSeries(input.option, { data: days }),
    days.map(([, amount]) => amount),
  );
  return {
    datasets: [],
    option: { ...option, calendar: { ...(option.calendar as Loose), range } },
    roles: input.roles,
    expanded: true,
  };
}

/**
 * The last number of the value role.
 *
 * @param input - The datasets and roles.
 * @returns The number, or `null` when there is none.
 */
function lastValue(input: PrepareInput): number | null {
  const [dataset] = input.datasets;
  if (!dataset) return null;
  const value =
    oneColumn(input.roles, 'value') ??
    dataset.dimensions.find((column) => column.type === 'number')?.name ??
    '';
  const numbers = columnValues(dataset, value).filter(
    (cell): cell is number => typeof cell === 'number',
  );
  return numbers.at(-1) ?? null;
}

/**
 * The last value on a dial.
 *
 * @param input - The option, datasets and roles.
 * @returns The prepared option.
 */
export function gauge(input: PrepareInput): Prepared {
  const name = oneColumn(input.roles, 'value') ?? '';
  const option = withFirstSeries(input.option, { data: [{ value: lastValue(input), name }] });
  return { datasets: [], option, roles: input.roles, expanded: true };
}

/**
 * The last value as a big number in the title, over a sparkline of the rest.
 *
 * @param input - The option, datasets and roles.
 * @returns The prepared option and data.
 */
export function kpi(input: PrepareInput): Prepared {
  const prepared = cartesian({
    ...input,
    roles: { ...input.roles, y: oneColumn(input.roles, 'value') ?? [] },
  });
  const { format, ...title } = (input.option.title ?? {}) as Loose;
  const formatter = namedFormatterSchema.safeParse(format);
  const last = lastValue(input);
  const text =
    last === null
      ? '–'
      : formatter.success
        ? createFormatter(formatter.data, input.format)(last)
        : String(last);
  return { ...prepared, option: { ...input.option, title: { ...title, text } } };
}

/**
 * Values per region name, on a map.
 *
 * @param input - The option, datasets and roles.
 * @returns The prepared option.
 */
export function regions(input: PrepareInput): Prepared {
  const [dataset] = input.datasets;
  const [region, value] = [
    oneColumn(input.roles, 'region') ?? '',
    oneColumn(input.roles, 'value') ?? '',
  ];
  const data = dataset
    ? dataset.source.map((row) => ({
        name: String(row[columnIndex(dataset, region)] ?? ''),
        value: row[columnIndex(dataset, value)] ?? null,
      }))
    : [];
  const option = withVisualRange(
    withFirstSeries(input.option, { data }),
    data.map((item) => item.value),
  );
  return { datasets: [], option, roles: input.roles, expanded: true };
}

/**
 * Values at latitude and longitude, as `[lon, lat, value, name]` points.
 *
 * @param input - The option, datasets and roles.
 * @returns The prepared option.
 */
export function points(input: PrepareInput): Prepared {
  const [dataset] = input.datasets;
  if (!dataset) return { datasets: [], option: input.option, roles: input.roles, expanded: true };
  const at = (role: string) => columnIndex(dataset, oneColumn(input.roles, role) ?? '');
  const [lat, lon, value, label] = [at('lat'), at('lon'), at('value'), at('label')];
  const data = dataset.source.map((row) => ({
    name: label < 0 ? '' : String(row[label] ?? ''),
    value: [row[lon] ?? null, row[lat] ?? null, row[value] ?? null],
  }));
  const option = withVisualRange(
    withFirstSeries(input.option, { data }),
    data.map((item) => item.value[2]),
  );
  return { datasets: [], option, roles: input.roles, expanded: true };
}

/**
 * The value role's x column, for cells of a matrix: the colour range follows the values.
 *
 * @param input - The option, datasets and roles.
 * @returns The prepared option.
 */
export function matrix(input: PrepareInput): Prepared {
  const [dataset] = input.datasets;
  const value = oneColumn(input.roles, 'value') ?? '';
  const values = dataset ? columnValues(dataset, value) : [];
  const x = dataset ? xColumn(input.roles, dataset) : undefined;
  const roles = x ? { ...input.roles, x } : input.roles;
  const columns = dataset && x ? new Set(columnValues(dataset, x)).size : 0;
  const option = columns > maxLabelledColumns ? withoutCellMarks(input.option) : input.option;
  return { datasets: input.datasets, option: withVisualRange(option, values), roles };
}

/** The most columns a heatmap shows its numbers and cell borders for; past it they crowd. */
const maxLabelledColumns = 24;

/**
 * A dense heatmap: no numbers in the cells and no borders, so the colours read.
 *
 * @param option - The option.
 * @returns The option with its series' labels and borders off.
 */
function withoutCellMarks(option: Loose): Loose {
  const series = [option.series ?? []].flat().map((each) => ({
    ...(each as Loose),
    label: { show: false },
    itemStyle: { borderWidth: 0 },
  }));
  return { ...option, series };
}
