/**
 * Preparations that build structures from rows: trees for treemaps and sunbursts, nodes and links
 * for sankeys and graphs, indicators and polygons for radars, and axes for parallel coordinates.
 */
import {
  type Cell,
  columnIndex,
  columnValues,
  type Dataset,
  rowsToGraph,
  rowsToTree,
} from '@querent/shared';
import type { Loose } from '../loose.ts';
import { allColumns, oneColumn } from '../roles.ts';
import { firstSeries, type Prepared, type PrepareInput, withFirstSeries } from './types.ts';

/**
 * The level columns and value built into a tree, put in the first series.
 *
 * @param input - The option, datasets and roles.
 * @returns The prepared option.
 */
export function tree(input: PrepareInput): Prepared {
  const [dataset] = input.datasets;
  const data = dataset
    ? rowsToTree(dataset, allColumns(input.roles, 'levels'), oneColumn(input.roles, 'value') ?? '')
    : [];
  return {
    datasets: [],
    option: withFirstSeries(input.option, { data }),
    roles: input.roles,
    expanded: true,
  };
}

/**
 * Links in order, less those that would close a loop: a sankey must flow one way.
 *
 * @param links - The links.
 * @returns The links that keep the flow acyclic.
 */
function acyclic<Link extends { source: string; target: string }>(links: readonly Link[]): Link[] {
  const next = new Map<string, Set<string>>();
  const reaches = (from: string, to: string, seen = new Set<string>()): boolean => {
    if (from === to) return true;
    seen.add(from);
    return [...(next.get(from) ?? [])].some((node) => !seen.has(node) && reaches(node, to, seen));
  };
  return links.filter((link) => {
    if (reaches(link.target, link.source)) return false;
    next.set(link.source, (next.get(link.source) ?? new Set()).add(link.target));
    return true;
  });
}

/**
 * Link rows built into nodes and links, put in the first series. A graph's nodes are sized by
 * their value; a sankey's loops are dropped.
 *
 * @param input - The option, datasets and roles.
 * @returns The prepared option.
 */
export function graph(input: PrepareInput): Prepared {
  const [dataset] = input.datasets;
  const columns = {
    source: oneColumn(input.roles, 'source') ?? '',
    target: oneColumn(input.roles, 'target') ?? '',
    value: oneColumn(input.roles, 'value') ?? '',
  };
  const built = dataset ? rowsToGraph(dataset, columns) : { nodes: [], links: [] };
  const isGraph = firstSeries(input.option).type === 'graph';
  const largest = Math.max(1, ...built.nodes.map((node) => node.value));
  const nodes = isGraph
    ? built.nodes.map((node) => ({ ...node, symbolSize: 8 + (28 * node.value) / largest }))
    : built.nodes;
  const links = isGraph ? built.links : acyclic(built.links);
  return {
    datasets: [],
    option: withFirstSeries(input.option, { data: nodes, links }),
    roles: input.roles,
    expanded: true,
  };
}

/**
 * The polygons of a radar: one per series, a value per indicator, 0 where a row is missing.
 *
 * @param dataset - The rows.
 * @param columns - The category, series and value columns; the series may be missing.
 * @param indicators - The categories, in order.
 * @returns The polygons.
 */
function polygons(
  dataset: Dataset,
  columns: { category: string; series: string | undefined; value: string },
  indicators: readonly string[],
) {
  const [at, seriesAt, valueAt] = [columns.category, columns.series ?? '', columns.value].map(
    (name) => columnIndex(dataset, name),
  );
  const seriesOf = (row: readonly Cell[]) =>
    seriesAt === undefined || seriesAt < 0 ? columns.value : String(row[seriesAt] ?? '');
  const names = [...new Set(dataset.source.map(seriesOf))];
  return names.map((name) => ({
    name,
    value: indicators.map((indicator) => {
      const row = dataset.source.find(
        (cells) => String(cells[at ?? -1]) === indicator && seriesOf(cells) === name,
      );
      return Number(row?.[valueAt ?? -1] ?? 0);
    }),
  }));
}

/**
 * Categories as radar indicators, and one polygon per series.
 *
 * @param input - The option, datasets and roles.
 * @returns The prepared option.
 */
export function radar(input: PrepareInput): Prepared {
  const [dataset] = input.datasets;
  if (!dataset) return { datasets: [], option: input.option, roles: input.roles, expanded: true };
  const category = oneColumn(input.roles, 'category') ?? '';
  const columns = {
    category,
    series: oneColumn(input.roles, 'series'),
    value: oneColumn(input.roles, 'value') ?? '',
  };
  const indicators = [...new Set(columnValues(dataset, category).map(String))];
  const data = polygons(dataset, columns, indicators);
  const top = Math.max(1, ...data.flatMap((item) => item.value));
  const indicator = indicators.map((name) => ({ name, max: Math.ceil(top * 1.1) }));
  const radarOption = { ...(input.option.radar as Loose), indicator };
  const option = { ...withFirstSeries(input.option, { data }), radar: radarOption };
  return { datasets: [], option, roles: input.roles, expanded: true };
}

/**
 * Number columns as parallel axes, and one series per group of rows.
 *
 * @param input - The option, datasets and roles.
 * @returns The prepared option.
 */
export function parallel(input: PrepareInput): Prepared {
  const [dataset] = input.datasets;
  const dimensions = allColumns(input.roles, 'dimensions');
  const group = oneColumn(input.roles, 'group');
  if (!dataset) return { datasets: [], option: input.option, roles: input.roles, expanded: true };
  const indexes = dimensions.map((name) => columnIndex(dataset, name));
  const groupAt = group ? columnIndex(dataset, group) : -1;
  const keys = [
    ...new Set(dataset.source.map((row) => (groupAt < 0 ? 'all' : String(row[groupAt] ?? '')))),
  ];
  const template = firstSeries(input.option);
  const series = keys.map((name) => ({
    ...template,
    name,
    data: dataset.source
      .filter((row) => groupAt < 0 || String(row[groupAt] ?? '') === name)
      .map((row) => indexes.map((index) => row[index] ?? null)),
  }));
  const parallelAxis = dimensions.map((name, dim) => ({ dim, name }));
  return {
    datasets: [],
    option: { ...input.option, series, parallelAxis },
    roles: input.roles,
    expanded: true,
  };
}
