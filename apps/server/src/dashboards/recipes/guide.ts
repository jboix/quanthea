/**
 * How each built-in recipe works, for the recipes screen: the fields the agent fills, an example
 * request, and the queries that example becomes. The examples run through the same expansion as
 * the agent's requests, so the queries shown are the queries written.
 */
import type { PanelQuery, QueryGuide } from '@querent/shared';
import { z } from 'zod';
import { expandPanel } from './expand.ts';
import { builtInSchemas, panelRequestSchema } from './request.ts';

/** What each field means, in the words the screen uses. */
const fieldHelp: Readonly<Record<string, string>> = {
  connector: 'The connector to query.',
  metric: 'The metric name.',
  filters: 'Conditions that must all hold. A value may be a variable such as $service.',
  by: 'What to split the result by: labels in PromQL, a column in SQL.',
  window: 'The window each rate is taken over.',
  show: 'How the panel draws.',
  unit: 'How values read.',
  match: 'The conditions that pick the part, such as code =~ "5..".',
  quantiles: 'The percentiles, as fractions.',
  aggregate: 'How series are combined.',
  limit: 'How many values or rows to keep.',
  table: 'The table, or schema.table.',
  time: 'The timestamp column, which keeps rows to the time range.',
  measure: 'What to compute: a count, or a function of a column.',
  bucket: 'The width of each time bucket.',
  columns: 'The columns to show.',
};

/** Fields every recipe has, left out of the guide. */
const commonFields = new Set(['recipe', 'title', 'description', 'width', 'replaces']);

/** An example request of each built-in recipe. */
const examples: Readonly<Record<keyof typeof builtInSchemas, Record<string, unknown>>> = {
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
    unit: 'EUR',
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
};

/**
 * A field's type as the screen writes it.
 *
 * @param schema - The field's JSON schema.
 * @returns Such as `string`, `string[]` or `"line" | "stat"`.
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
 * The fields of a recipe the agent fills.
 *
 * @param schema - The recipe's schema.
 * @returns The fields, in the schema's order.
 */
function fieldsOf(schema: z.ZodObject): QueryGuide['fields'] {
  return Object.entries(schema.shape)
    .filter(([name]) => !commonFields.has(name))
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
 * The text of a query.
 *
 * @param query - The query.
 * @returns Its SQL or PromQL.
 */
export function queryText(query: PanelQuery): string {
  return query.language === 'sql' ? query.sql : query.expr;
}

/**
 * How each built-in recipe works.
 *
 * @returns One guide per recipe, in the order the schemas list them.
 */
export function builderGuides(): QueryGuide[] {
  return Object.entries(builtInSchemas).map(([id, schema]) => {
    const example = examples[id as keyof typeof builtInSchemas];
    const request = panelRequestSchema.parse({ recipe: id, title: 'Example', ...example });
    const queries = expandPanel(request).queries.map(queryText);
    return { id, fields: fieldsOf(schema), example, queries };
  });
}
