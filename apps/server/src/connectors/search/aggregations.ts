/**
 * The aggregations of a search, as one long table: a column per bucket aggregation, level by level
 * (a date histogram gives the time, terms give a series), and a column per metric of the deepest
 * level, or `count` when it has none. `date_histogram > terms > avg` gives `(time, series, avg)`.
 * A filter with no bucket aggregation under it is a metric: its count, or its metrics. An
 * aggregation whose name starts with `_` is a helper, such as the parts of a ratio: no column, and
 * for a bucket aggregation no key column.
 */
import type { FieldType, Frame } from '@quanthea/shared';
import { ConnectorError, createFrameBuilder, type ExecutionContext } from '../_shared/index.ts';

/** An aggregation as the request declares it. */
interface AggregationSpec {
  /** Its name, which names its column. */
  readonly name: string;
  /** Its type, such as `terms` or `avg`. */
  readonly type: string;
  /** Its sub-aggregations. */
  readonly children: readonly AggregationSpec[];
}

/** A table being filled: its columns and their types, and its rows by column. */
interface Table {
  /** The columns, in the order they appear. */
  readonly columns: Map<string, FieldType>;
  /** The rows. */
  readonly rows: Map<string, unknown>[];
  /** The most rows to collect. */
  readonly limit: number;
}

/** A node of the answer: an aggregation's result or a bucket. */
type AnswerNode = Readonly<Record<string, unknown>>;

/** Aggregations whose buckets become rows. */
const bucketTypes = new Set([
  'date_histogram',
  'auto_date_histogram',
  'histogram',
  'variable_width_histogram',
  'terms',
  'multi_terms',
  'rare_terms',
  'significant_terms',
  'range',
  'date_range',
  'ip_range',
  'filters',
  'composite',
  'geohash_grid',
  'geotile_grid',
  'adjacency_matrix',
]);

/** Aggregations with one bucket, whose sub-aggregations continue the level. */
const singleBucketTypes = new Set([
  'filter',
  'global',
  'missing',
  'nested',
  'reverse_nested',
  'sampler',
  'diversified_sampler',
]);

/** Bucket aggregations whose keys are times. */
const timeTypes = new Set(['date_histogram', 'auto_date_histogram']);

/** The statistics of a `stats` or `extended_stats` result. */
const statistics = ['count', 'min', 'max', 'avg', 'sum'] as const;

/**
 * Reads the aggregations a request declares.
 *
 * @param aggs - The `aggs` or `aggregations` object of a request level.
 * @returns The aggregations.
 */
export function aggregationSpecs(aggs: unknown): AggregationSpec[] {
  if (typeof aggs !== 'object' || aggs === null) return [];
  return Object.entries(aggs as Record<string, Record<string, unknown>>).map(([name, body]) => {
    const type = Object.keys(body).find((key) => !['aggs', 'aggregations', 'meta'].includes(key));
    return { name, type: type ?? '', children: aggregationSpecs(body.aggs ?? body.aggregations) };
  });
}

/**
 * The buckets of a bucket aggregation's result, as a list whether or not it is keyed.
 *
 * @param node - The result.
 * @returns The buckets, each with its `key`.
 */
function bucketsOf(node: unknown): AnswerNode[] {
  const buckets = (node as AnswerNode | undefined)?.buckets;
  if (Array.isArray(buckets)) return buckets as AnswerNode[];
  if (typeof buckets !== 'object' || buckets === null) return [];
  return Object.entries(buckets as Record<string, AnswerNode>).map(([key, bucket]) => ({
    ...bucket,
    key,
  }));
}

/**
 * Sets a value in a row, and the type of its column the first time.
 *
 * @param table - The table.
 * @param row - The row.
 * @param column - The column.
 * @param value - The value.
 * @param type - The column's type.
 */
function setCell(
  table: Table,
  row: Map<string, unknown>,
  column: string,
  value: unknown,
  type: FieldType,
): void {
  if (!table.columns.has(column)) table.columns.set(column, type);
  row.set(column, value);
}

/**
 * Puts a bucket's key in a row: one column, or one per part of a composite key.
 *
 * @param table - The table.
 * @param row - The row.
 * @param spec - The bucket aggregation.
 * @param bucket - The bucket.
 */
function setKey(
  table: Table,
  row: Map<string, unknown>,
  spec: AggregationSpec,
  bucket: AnswerNode,
): void {
  if (spec.name.startsWith('_')) return;
  for (const [column, value] of keyParts(spec, bucket)) {
    const time = column === spec.name && timeTypes.has(spec.type);
    setCell(table, row, column, value, time ? 'time' : scalarType(value));
  }
}

/**
 * The columns a bucket's key fills: each part of a composite key, or the aggregation's own column.
 *
 * @param spec - The bucket aggregation.
 * @param bucket - The bucket.
 * @returns Column name and value pairs.
 */
function keyParts(spec: AggregationSpec, bucket: AnswerNode): (readonly [string, unknown])[] {
  const key = bucket.key;
  if (typeof key === 'object' && key !== null && !Array.isArray(key)) return Object.entries(key);
  return [[spec.name, Array.isArray(key) ? (bucket.key_as_string ?? key.join('|')) : key]];
}

/**
 * The column type of a key.
 *
 * @param value - The key.
 * @returns `number` for a number, else `string`.
 */
function scalarType(value: unknown): FieldType {
  return typeof value === 'number' ? 'number' : 'string';
}

/**
 * The values of one metric's result: `value`, each percentile, or each statistic.
 *
 * @param spec - The metric aggregation.
 * @param node - Its result.
 * @returns Column name and value pairs.
 */
function metricValues(spec: AggregationSpec, node: AnswerNode | undefined): [string, unknown][] {
  if (node === undefined || 'value' in node) return [[spec.name, node?.value ?? null]];
  const values = node.values;
  if (Array.isArray(values))
    return values.map((item: AnswerNode) => [`${spec.name} p${Number(item.key)}`, item.value]);
  if (typeof values === 'object' && values !== null)
    return Object.entries(values).map(([key, value]) => [`${spec.name} p${Number(key)}`, value]);
  return statistics
    .filter((stat) => stat in node)
    .map((stat) => [`${spec.name} ${stat}`, node[stat]]);
}

/**
 * Whether an aggregation groups rows: a bucket aggregation, or a single-bucket one with a bucket
 * aggregation under it.
 *
 * @param spec - The aggregation.
 * @returns `true` when it makes a level.
 */
function grouping(spec: AggregationSpec): boolean {
  if (bucketTypes.has(spec.type)) return true;
  return singleBucketTypes.has(spec.type) && spec.children.some(grouping);
}

/**
 * The columns of one metric of a level: a metric's values, or a single-bucket aggregation's count
 * or the values of its metrics. A helper (`_` name) gives none.
 *
 * @param spec - The aggregation.
 * @param node - Its result.
 * @returns Column name and value pairs.
 */
function metricColumns(spec: AggregationSpec, node: AnswerNode | undefined): [string, unknown][] {
  if (spec.name.startsWith('_')) return [];
  if (!singleBucketTypes.has(spec.type)) return metricValues(spec, node);
  if (spec.children.length === 0) return [[spec.name, node?.doc_count ?? null]];
  return spec.children.flatMap((child) =>
    metricColumns(child, node?.[child.name] as AnswerNode | undefined),
  );
}

/**
 * Adds the row of a level with no bucket aggregation: its metrics.
 *
 * @param table - The table.
 * @param specs - The level's aggregations, all metrics.
 * @param node - The level's result.
 * @param prefix - The keys of the enclosing buckets.
 */
function addMetricRow(
  table: Table,
  specs: readonly AggregationSpec[],
  node: AnswerNode,
  prefix: ReadonlyMap<string, unknown>,
): void {
  const row = new Map(prefix);
  for (const spec of specs) {
    for (const [column, value] of metricColumns(spec, node[spec.name] as AnswerNode | undefined))
      setCell(table, row, column, value, 'number');
  }
  table.rows.push(row);
}

/**
 * Walks one level of the answer and adds its rows.
 *
 * @param table - The table.
 * @param specs - The level's aggregations.
 * @param node - The level's result.
 * @param prefix - The keys of the enclosing buckets.
 * @throws {ConnectorError} `rejected` for two bucket aggregations side by side.
 */
function walk(
  table: Table,
  specs: readonly AggregationSpec[],
  node: AnswerNode,
  prefix: ReadonlyMap<string, unknown>,
): void {
  const levels = specs.filter(grouping);
  if (levels.length > 1) {
    throw new ConnectorError(
      'rejected',
      'A search gives one table: nest bucket aggregations instead of putting them side by side.',
    );
  }
  const [bucket] = levels;
  if (bucket === undefined) addMetricRow(table, specs, node, prefix);
  else if (singleBucketTypes.has(bucket.type))
    walk(table, bucket.children, (node[bucket.name] ?? {}) as AnswerNode, prefix);
  else walkBuckets(table, bucket, (node[bucket.name] ?? {}) as AnswerNode, prefix);
}

/**
 * Adds the rows of each bucket of a bucket aggregation.
 *
 * @param table - The table.
 * @param spec - The bucket aggregation.
 * @param node - Its result.
 * @param prefix - The keys of the enclosing buckets.
 */
function walkBuckets(
  table: Table,
  spec: AggregationSpec,
  node: AnswerNode,
  prefix: ReadonlyMap<string, unknown>,
): void {
  for (const bucket of bucketsOf(node)) {
    if (table.rows.length > table.limit) return;
    const row = new Map(prefix);
    setKey(table, row, spec, bucket);
    if (spec.children.length > 0) walk(table, spec.children, bucket, row);
    else {
      setCell(table, row, 'count', bucket.doc_count ?? null, 'number');
      table.rows.push(row);
    }
  }
}

/**
 * The table of a search's aggregations.
 *
 * @param aggs - The `aggs` of the request.
 * @param answer - The `aggregations` of the answer.
 * @param context - The execution context.
 * @param durationMs - How long the search took.
 * @returns The frame.
 * @throws {ConnectorError} `rejected` for bucket aggregations side by side.
 */
export function aggregationsFrame(
  aggs: unknown,
  answer: AnswerNode,
  context: ExecutionContext,
  durationMs: number,
): Frame {
  const table: Table = { columns: new Map(), rows: [], limit: context.maxRows };
  walk(table, aggregationSpecs(aggs), answer, new Map());
  const fields = [...table.columns].map(([name, type]) => ({ name, type }));
  const builder = createFrameBuilder({ refId: context.refId, fields, maxRows: context.maxRows });
  for (const row of table.rows) {
    const values = fields.map((field) => cellValue(field.type, row.get(field.name)));
    if (!builder.add(values)) break;
  }
  return builder.build(durationMs);
}

/**
 * A cell as a frame value: numbers finite or `null`, times as epoch milliseconds.
 *
 * @param type - The column's type.
 * @param value - The value from the answer.
 * @returns The frame value.
 */
function cellValue(type: FieldType, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (type === 'string') return String(value);
  const number = type === 'time' && typeof value === 'string' ? Date.parse(value) : Number(value);
  return Number.isFinite(number) ? number : null;
}
