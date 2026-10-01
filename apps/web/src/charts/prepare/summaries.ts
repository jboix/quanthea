/**
 * Preparations that summarise rows: raw values binned for a histogram, raw values per group
 * summed up in five numbers for a box plot, and changes walked for a waterfall.
 */
import {
  type Cell,
  columnIndex,
  columnValues,
  type Dataset,
  fiveNumbers,
  histogramBins,
} from '@quanthea/shared';
import { oneColumn } from '../roles.ts';
import type { Prepared, PrepareInput } from './types.ts';

/**
 * A number short enough for a bin label.
 *
 * @param value - The number.
 * @returns Such as `1.2k` or `40`.
 */
function short(value: number): string {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(
    value,
  );
}

/**
 * The value role's numbers binned: columns `bin` and `count`.
 *
 * @param input - The datasets and roles.
 * @returns The prepared data.
 */
export function bins(input: PrepareInput): Prepared {
  const [dataset] = input.datasets;
  const value =
    oneColumn(input.roles, 'value') ??
    dataset?.dimensions.find((column) => column.type === 'number')?.name;
  const counted = dataset && value ? histogramBins(columnValues(dataset, value)) : [];
  const binned: Dataset = {
    dimensions: [
      { name: 'bin', type: 'string' },
      { name: 'count', type: 'number' },
    ],
    source: counted.map((bin) => [`${short(bin.start)}–${short(bin.end)}`, bin.count]),
  };
  return { datasets: [binned], option: input.option, roles: input.roles };
}

/**
 * The value role's numbers summed up per group: columns `group`, `min`, `q1`, `median`, `q3`
 * and `max`.
 *
 * @param input - The datasets and roles.
 * @returns The prepared data.
 */
export function boxplot(input: PrepareInput): Prepared {
  const [dataset] = input.datasets;
  const value = oneColumn(input.roles, 'value') ?? '';
  const group = oneColumn(input.roles, 'group');
  const names = ['group', 'min', 'q1', 'median', 'q3', 'max'];
  const dimensions = names.map((name, index) => ({
    name,
    type: index === 0 ? ('string' as const) : ('number' as const),
  }));
  if (!dataset)
    return { datasets: [{ dimensions, source: [] }], option: input.option, roles: input.roles };
  const [valueAt, groupAt] = [
    columnIndex(dataset, value),
    group ? columnIndex(dataset, group) : -1,
  ];
  const keys = [
    ...new Set(dataset.source.map((row) => (groupAt < 0 ? value : String(row[groupAt] ?? '')))),
  ];
  const source = keys.flatMap((key) => {
    const rows = dataset.source.filter((row) => groupAt < 0 || String(row[groupAt] ?? '') === key);
    const summary = fiveNumbers(rows.map((row) => row[valueAt] ?? null));
    return summary ? [[key, ...summary]] : [];
  });
  return { datasets: [{ dimensions, source }], option: input.option, roles: input.roles };
}

/**
 * The walk from a starting total through changes: columns `category`, `base`, `up` and `down`,
 * the first row the start and a last row the end total.
 *
 * @param input - The datasets and roles.
 * @returns The prepared data.
 */
export function waterfall(input: PrepareInput): Prepared {
  const [dataset] = input.datasets;
  const [category, change] = [
    oneColumn(input.roles, 'category') ?? '',
    oneColumn(input.roles, 'change') ?? '',
  ];
  const rows = dataset
    ? dataset.source.map(
        (row) =>
          [
            row[columnIndex(dataset, category)],
            Number(row[columnIndex(dataset, change)] ?? 0),
          ] as const,
      )
    : [];
  let total = 0;
  const source: Cell[][] = rows.map(([name, value], index) => {
    const before = total;
    total += value;
    if (index === 0) return [String(name ?? ''), 0, value, 0];
    return [String(name ?? ''), Math.min(before, total), Math.max(value, 0), Math.max(-value, 0)];
  });
  const dimensions = ['category', 'base', 'up', 'down'].map((name, index) => ({
    name,
    type: index === 0 ? ('string' as const) : ('number' as const),
  }));
  const walked = rows.length > 0 ? [...source, ['Total', 0, total, 0]] : [];
  return { datasets: [{ dimensions, source: walked }], option: input.option, roles: input.roles };
}
