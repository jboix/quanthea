/**
 * Reshaping datasets for the charts that need another shape: long to wide and back, rows to a
 * tree or a graph, raw values to bins or quartiles, and the filters and sorts a view applies.
 */
import type { Cell, Dataset, Dimension } from './contract.ts';

/**
 * The index of a column.
 *
 * @param dataset - The dataset.
 * @param name - The column.
 * @returns The index, or -1.
 */
export function columnIndex(dataset: Dataset, name: string): number {
  return dataset.dimensions.findIndex((column) => column.name === name);
}

/**
 * The values of a column.
 *
 * @param dataset - The dataset.
 * @param name - The column.
 * @returns The values, empty when there is no such column.
 */
export function columnValues(dataset: Dataset, name: string): Cell[] {
  const index = columnIndex(dataset, name);
  return index < 0 ? [] : dataset.source.map((row) => row[index] ?? null);
}

/**
 * Orders two cells: numbers by value, anything else as text, missing values last.
 *
 * @param first - One cell.
 * @param second - The other.
 * @returns Negative, zero or positive.
 */
export function compareCells(first: Cell, second: Cell): number {
  if (first === null || second === null)
    return (first === null ? 1 : 0) - (second === null ? 1 : 0);
  if (typeof first === 'number' && typeof second === 'number') return first - second;
  return String(first).localeCompare(String(second));
}

/**
 * The indexes of columns, when all exist.
 *
 * @param dataset - The dataset.
 * @param names - The columns.
 * @returns The indexes, or `undefined` when one is missing.
 */
export function columnIndexes(dataset: Dataset, names: readonly string[]): number[] | undefined {
  const indexes = names.map((name) => columnIndex(dataset, name));
  return indexes.every((index) => index >= 0) ? indexes : undefined;
}

/** The columns of a long table. */
export interface LongColumns {
  /** The x: time or category. */
  readonly x: string;
  /** The column naming each series. */
  readonly series: string;
  /** The value. */
  readonly value: string;
}

/**
 * A long table as a wide one: one row per x, one number column per series, in the order the
 * series first appear.
 *
 * @param dataset - The long table.
 * @param columns - Its x, series and value columns.
 * @returns The wide table, or the dataset unchanged when a column is missing.
 */
export function longToWide(dataset: Dataset, columns: LongColumns): Dataset {
  const indexes = columnIndexes(dataset, [columns.x, columns.series, columns.value]);
  if (!indexes) return dataset;
  const [x = 0, series = 0, value = 0] = indexes;
  const names = [...new Set(dataset.source.map((row) => String(row[series] ?? '')))];
  const rows = new Map<Cell, Cell[]>();
  for (const row of dataset.source) {
    const key = row[x] ?? null;
    const wide = rows.get(key) ?? [key, ...names.map(() => null)];
    wide[names.indexOf(String(row[series] ?? '')) + 1] = row[value] ?? null;
    rows.set(key, wide);
  }
  const unit = dataset.dimensions[value]?.unit;
  const numbers: Dimension[] = names.map((name) => ({
    name,
    type: 'number',
    ...(unit ? { unit } : {}),
  }));
  const xColumn = dataset.dimensions[x] ?? { name: columns.x, type: 'string' };
  return { dimensions: [xColumn, ...numbers], source: [...rows.values()] };
}

/**
 * A wide table as a long one: one row per x and value column.
 *
 * @param dataset - The wide table.
 * @param x - Its x column.
 * @param values - Its value columns.
 * @returns The long table: x, series, value.
 */
export function wideToLong(dataset: Dataset, x: string, values: readonly string[]): Dataset {
  const xIndex = columnIndex(dataset, x);
  const xColumn = dataset.dimensions[xIndex];
  if (!xColumn) return dataset;
  const indexes = values
    .map((name) => [name, columnIndex(dataset, name)] as const)
    .filter(([, at]) => at >= 0);
  const source = dataset.source.flatMap((row) =>
    indexes.map(([name, at]) => [row[xIndex] ?? null, name, row[at] ?? null]),
  );
  const dimensions: Dimension[] = [
    xColumn,
    { name: 'series', type: 'string' },
    { name: 'value', type: 'number' },
  ];
  return { dimensions, source };
}

/** A node of a tree, as treemaps and sunbursts take them. */
export interface TreeNode {
  /** Its name. */
  readonly name: string;
  /** Its value; a parent's is the sum of its children's when not given. */
  value?: number;
  /** Its children. */
  children?: TreeNode[];
}

/**
 * The child of a node with a name, added when missing.
 *
 * @param siblings - The node's children.
 * @param name - The name.
 * @returns The child.
 */
function childNamed(siblings: TreeNode[], name: string): TreeNode {
  const found = siblings.find((node) => node.name === name);
  if (found) return found;
  const node: TreeNode = { name };
  siblings.push(node);
  return node;
}

/**
 * Rows with a column per level as a tree: each row is a leaf, its path the level values.
 *
 * @param dataset - The rows.
 * @param levels - The level columns, from the root down.
 * @param value - The value column.
 * @returns The roots.
 */
export function rowsToTree(dataset: Dataset, levels: readonly string[], value: string): TreeNode[] {
  const indexes = levels.map((name) => columnIndex(dataset, name)).filter((index) => index >= 0);
  const valueIndex = columnIndex(dataset, value);
  const roots: TreeNode[] = [];
  for (const row of dataset.source) {
    const path = indexes.map((index) => row[index]).filter((cell) => cell !== null && cell !== '');
    let siblings = roots;
    let node: TreeNode | undefined;
    for (const step of path) {
      node = childNamed(siblings, String(step));
      node.children ??= [];
      siblings = node.children;
    }
    if (node) node.value = (node.value ?? 0) + Number(row[valueIndex] ?? 0);
  }
  return pruneEmpty(roots);
}

/**
 * Drops the empty `children` lists leaves were given while the tree was built.
 *
 * @param nodes - The nodes.
 * @returns The nodes.
 */
function pruneEmpty(nodes: TreeNode[]): TreeNode[] {
  for (const node of nodes) {
    if (node.children?.length === 0) delete node.children;
    else if (node.children) pruneEmpty(node.children);
  }
  return nodes;
}

/** A graph, as sankeys and graph charts take them. */
export interface Graph {
  /** The nodes, named once each. */
  readonly nodes: { name: string; value: number }[];
  /** The links. */
  readonly links: { source: string; target: string; value: number }[];
}

/**
 * Link rows as a graph. The nodes come from the links; a node's value is the larger of what flows
 * in and what flows out.
 *
 * @param dataset - The link rows.
 * @param columns - The source, target and value columns.
 * @param columns.source - The source column.
 * @param columns.target - The target column.
 * @param columns.value - The value column.
 * @returns The graph.
 */
export function rowsToGraph(
  dataset: Dataset,
  columns: { readonly source: string; readonly target: string; readonly value: string },
): Graph {
  const [source, target, value] = [columns.source, columns.target, columns.value].map((name) =>
    columnIndex(dataset, name),
  );
  const flows = new Map<string, { in: number; out: number }>();
  const links = dataset.source.map((row) => {
    const link = {
      source: String(row[source ?? -1] ?? ''),
      target: String(row[target ?? -1] ?? ''),
      value: Number(row[value ?? -1] ?? 0),
    };
    const from = flows.get(link.source) ?? { in: 0, out: 0 };
    const to = flows.get(link.target) ?? { in: 0, out: 0 };
    flows.set(link.source, { ...from, out: from.out + link.value });
    flows.set(link.target, { ...to, in: to.in + link.value });
    return link;
  });
  const nodes = [...flows].map(([name, flow]) => ({ name, value: Math.max(flow.in, flow.out) }));
  return { nodes, links };
}

/** One bin of a histogram. */
export interface Bin {
  /** Where it starts, included. */
  readonly start: number;
  /** Where it ends, excluded but for the last bin. */
  readonly end: number;
  /** How many values fall in it. */
  readonly count: number;
}

/**
 * Bins numbers into equal-width bins; the count follows Sturges' rule, from 5 to 30.
 *
 * @param values - The numbers; missing and non-finite values are left out.
 * @param binCount - How many bins, instead of the rule.
 * @returns The bins, empty when there are no numbers.
 */
export function histogramBins(values: readonly Cell[], binCount?: number): Bin[] {
  const numbers = values.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  );
  if (numbers.length === 0) return [];
  const [min, max] = [Math.min(...numbers), Math.max(...numbers)];
  const count = binCount ?? Math.min(30, Math.max(5, Math.ceil(Math.log2(numbers.length)) + 1));
  const width = max === min ? 1 : (max - min) / count;
  const counts = Array.from({ length: count }, () => 0);
  for (const value of numbers) {
    const index = Math.min(count - 1, Math.floor((value - min) / width));
    counts[index] = (counts[index] ?? 0) + 1;
  }
  return counts.map((binned, index) => ({
    start: min + index * width,
    end: min + (index + 1) * width,
    count: binned,
  }));
}

/**
 * The five-number summary of numbers, for a boxplot, with linear interpolation between ranks.
 *
 * @param values - The numbers; missing and non-finite values are left out.
 * @returns Minimum, first quartile, median, third quartile and maximum, or `undefined` when empty.
 */
export function fiveNumbers(
  values: readonly Cell[],
): [number, number, number, number, number] | undefined {
  const sorted = values
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    .sort((a, b) => a - b);
  if (sorted.length === 0) return undefined;
  const at = (fraction: number) => {
    const rank = fraction * (sorted.length - 1);
    const low = Math.floor(rank);
    const high = Math.ceil(rank);
    return (sorted[low] ?? 0) + ((sorted[high] ?? 0) - (sorted[low] ?? 0)) * (rank - low);
  };
  return [at(0), at(0.25), at(0.5), at(0.75), at(1)];
}

/**
 * Keeps the rows whose column holds one of some values.
 *
 * @param dataset - The dataset.
 * @param column - The column.
 * @param kept - The values to keep, as text.
 * @returns The dataset with only those rows.
 */
export function filterRows(dataset: Dataset, column: string, kept: readonly string[]): Dataset {
  const index = columnIndex(dataset, column);
  if (index < 0) return dataset;
  const set = new Set(kept);
  return { ...dataset, source: dataset.source.filter((row) => set.has(String(row[index]))) };
}

/**
 * Sorts the rows by a column.
 *
 * @param dataset - The dataset.
 * @param column - The column.
 * @param direction - Ascending or descending.
 * @returns The sorted dataset.
 */
export function sortRows(dataset: Dataset, column: string, direction: 'asc' | 'desc'): Dataset {
  const index = columnIndex(dataset, column);
  if (index < 0) return dataset;
  const sign = direction === 'asc' ? 1 : -1;
  const source = [...dataset.source].sort(
    (a, b) => sign * compareCells(a[index] ?? null, b[index] ?? null),
  );
  return { ...dataset, source };
}
