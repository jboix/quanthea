/**
 * Small multiples: one small chart per value of the facet column, laid out in a grid, sharing the
 * y scale, with their tooltips linked.
 */
import { columnIndex, columnValues } from '@querent/shared';
import type { Loose } from '../loose.ts';
import { oneColumn } from '../roles.ts';
import { firstSeries, type Prepared, type PrepareInput } from './types.ts';

/** The most small charts drawn. */
const maxFacets = 9;

/**
 * Where each small chart goes, in percent of the panel.
 *
 * @param count - How many charts.
 * @returns One box per chart.
 */
function boxes(count: number): { left: string; top: string; width: string; height: string }[] {
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const [width, height] = [100 / columns, 100 / rows];
  return Array.from({ length: count }, (_box, index) => ({
    left: `${(index % columns) * width + 6}%`,
    top: `${Math.floor(index / columns) * height + 9}%`,
    width: `${width - 9}%`,
    height: `${height - 17}%`,
  }));
}

/**
 * The axes, titles and series of the small charts.
 *
 * @param input - The option and roles.
 * @param names - The facet values.
 * @param grid - Where each chart goes.
 * @returns The parts of the option.
 */
function facetParts(
  input: PrepareInput,
  names: readonly string[],
  grid: ReturnType<typeof boxes>,
): Loose {
  const [x, y] = [oneColumn(input.roles, 'x'), oneColumn(input.roles, 'y')];
  const template = firstSeries(input.option);
  const axis = (key: 'xAxis' | 'yAxis', index: number) => ({
    ...(input.option[key] as Loose),
    gridIndex: index,
  });
  const titleTop = (index: number) => `${Number.parseFloat(grid[index]?.top ?? '0') - 7}%`;
  return {
    xAxis: names.map((_name, index) => axis('xAxis', index)),
    yAxis: names.map((_name, index) => axis('yAxis', index)),
    title: names.map((name, index) => ({
      text: name,
      left: grid[index]?.left,
      top: titleTop(index),
      textStyle: { fontSize: 12, fontWeight: 500 },
    })),
    series: names.map((name, index) => ({
      ...template,
      name,
      datasetIndex: index,
      xAxisIndex: index,
      yAxisIndex: index,
      encode: { x, y },
    })),
  };
}

/**
 * One small chart per facet value.
 *
 * @param input - The option, datasets and roles.
 * @returns The prepared option: grids, axes, titles and series, and a dataset per facet.
 */
export function facets(input: PrepareInput): Prepared {
  const [dataset] = input.datasets;
  const facet = oneColumn(input.roles, 'facet') ?? '';
  if (!dataset) return { datasets: [], option: input.option, roles: input.roles, expanded: true };
  const at = columnIndex(dataset, facet);
  const names = [...new Set(columnValues(dataset, facet).map(String))].slice(0, maxFacets);
  const datasets = names.map((name) => ({
    ...dataset,
    source: dataset.source.filter((row) => String(row[at]) === name),
  }));
  const grid = boxes(names.length);
  const option = { ...input.option, ...facetParts(input, names, grid) };
  return { datasets, option, roles: input.roles, expanded: true, grid };
}
