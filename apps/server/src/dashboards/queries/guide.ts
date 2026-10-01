/**
 * How each query builder works, for the queries screen and the agent's guide: the fields the agent
 * fills, an example request, the query it becomes, and the columns it returns. The examples run
 * through the same builders as the agent's requests, so the queries shown are the queries written.
 */
import { type QueryGuide, queryText } from '@querent/shared';
import { z } from 'zod';
import { buildData } from './build.ts';
import { builderSchemas, dataSchema } from './request.ts';

/** What each field means, in the words the screen uses. */
const fieldHelp: Readonly<Record<string, string>> = {
  connector: 'The connector to query.',
  metric: 'The metric name.',
  filters: 'Conditions that must all hold. A value may be a variable such as $service.',
  by: 'What to split the result by: labels in PromQL, a column in SQL, a field in a search.',
  window: 'The window each rate is taken over.',
  match: 'The conditions that pick the part, such as code =~ "5.." or level = error.',
  of: 'The conditions that pick the whole; every document when empty.',
  over: 'time for a series, range for one value (per "by" value) over the whole range.',
  complement: 'Give one minus the share, such as a success rate from errors.',
  counts: 'Also return the part and the whole as matching and total.',
  index: 'The index or pattern, such as logs-*.',
  series: 'A second field to split each value by.',
  field: 'The numeric field.',
  width: "The width of each bin, in the field's unit.",
  fields: 'The document fields to return.',
  interval: 'The width of each time bucket; the dashboard picks one when left out.',
  quantiles: 'The percentiles, as fractions.',
  aggregate: 'How series are combined.',
  limit: 'How many values or rows to keep.',
  table: 'The table, or schema.table.',
  time: 'The timestamp column or field, which keeps rows to the time range.',
  measure: 'What to compute: a count, or a function of a column or field.',
  bucket: 'The width of each time bucket.',
  columns: 'The columns to return.',
};

/** An example request of each builder. */
const examples: Readonly<Record<keyof typeof builderSchemas, Record<string, unknown>>> = {
  rate: {
    connector: 'prometheus',
    metric: 'http_requests_total',
    filters: [{ field: 'service', value: '$service' }],
    by: ['code'],
  },
  ratio: {
    connector: 'prometheus',
    metric: 'http_requests_total',
    match: [{ field: 'code', op: '=~', value: '5..' }],
    by: ['service'],
  },
  latency: { connector: 'prometheus', metric: 'http_request_duration_seconds', by: ['service'] },
  gauge: { connector: 'prometheus', metric: 'process_resident_memory_bytes', by: ['job'] },
  top: { connector: 'prometheus', metric: 'http_requests_total', by: ['path'], limit: 5 },
  'sql-series': {
    connector: 'postgres',
    table: 'orders',
    time: 'created_at',
    by: 'status',
    bucket: '15m',
  },
  'sql-breakdown': {
    connector: 'postgres',
    table: 'orders',
    by: 'region',
    time: 'created_at',
    measure: { fn: 'sum', column: 'total' },
  },
  'sql-stat': {
    connector: 'postgres',
    table: 'orders',
    time: 'created_at',
    filters: [{ field: 'status', value: 'failed' }],
  },
  'sql-rows': {
    connector: 'postgres',
    table: 'orders',
    columns: ['id', 'status', 'total'],
    time: 'created_at',
  },
  'search-series': {
    connector: 'opensearch',
    index: 'logs-*',
    filters: [{ field: 'service', value: '$service' }],
    by: 'level',
  },
  'search-ratio': {
    connector: 'opensearch',
    index: 'logs-*',
    match: [{ field: 'level', value: 'error' }],
    of: [{ field: 'route', op: '!=', value: 'deploy' }],
    by: 'service',
  },
  'search-breakdown': {
    connector: 'opensearch',
    index: 'logs-*',
    by: 'service',
    measure: { fn: 'percentiles', field: 'duration_ms', percents: [95] },
  },
  'search-stat': {
    connector: 'opensearch',
    index: 'logs-*',
    filters: [{ field: 'level', value: 'error' }],
  },
  'search-histogram': {
    connector: 'opensearch',
    index: 'logs-*',
    field: 'duration_ms',
    width: 100,
  },
  'search-rows': {
    connector: 'opensearch',
    index: 'logs-*',
    fields: ['@timestamp', 'service', 'level', 'message'],
    filters: [{ field: 'level', value: 'error' }],
  },
};

/**
 * A field's type as the screen writes it.
 *
 * @param schema - The field's JSON schema.
 * @returns Such as `string`, `string[]` or `"sum" | "avg"`.
 */
function typeText(schema: Record<string, unknown>): string {
  if (Array.isArray(schema.enum))
    return schema.enum.map((value) => JSON.stringify(value)).join(' | ');
  if (schema.type === 'array')
    return `${typeText((schema.items ?? {}) as Record<string, unknown>)}[]`;
  if (schema.type === 'object') return `{ ${Object.keys(schema.properties ?? {}).join(', ')} }`;
  return String(schema.type ?? 'any');
}

/**
 * The fields of a builder the agent fills.
 *
 * @param schema - The builder's schema.
 * @returns The fields, in the schema's order.
 */
function fieldsOf(schema: z.ZodObject): QueryGuide['fields'] {
  return Object.entries(schema.shape)
    .filter(([name]) => name !== 'kind')
    .map(([name, field]) => {
      const json = z.toJSONSchema(field as z.ZodType, { io: 'input', unrepresentable: 'any' });
      const required = !(field as z.ZodType).safeParse(undefined).success;
      const described = {
        name,
        type: typeText(json),
        required,
        description: fieldHelp[name] ?? '',
      };
      return 'default' in json ? { ...described, default: json.default } : described;
    });
}

/**
 * How each query builder works.
 *
 * @returns One guide per builder, in the order the schemas list them.
 */
export function builderGuides(): QueryGuide[] {
  return Object.entries(builderSchemas).map(([id, schema]) => {
    const example = examples[id as keyof typeof builderSchemas];
    const built = buildData(dataSchema.parse({ kind: id, ...example }));
    const output = {
      shape: built.output.shape,
      columns: [...built.output.columns],
      chart: built.output.chart,
    };
    return { id, fields: fieldsOf(schema), example, queries: built.queries.map(queryText), output };
  });
}
