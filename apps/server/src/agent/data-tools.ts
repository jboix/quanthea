/**
 * The tools that explore data beyond the catalog: describe a schema, sample values, and test a
 * query. Every answer comes from the model view, so the gate decides what the model sees.
 */
import { tool } from 'ai';
import { z } from 'zod';
import type { RunContext } from './run-context.ts';

/** How far back a test query looks when the model gives no time range. */
const defaultTestRange = { from: 'now-6h', to: 'now' };

/** Validates the options of a PromQL or LogQL expression. */
const expressionOptions = {
  expr: z.string().min(1).max(10_000),
  instant: z.boolean().optional(),
  step: z
    .string()
    .regex(/^\d{1,5}[smhd]$/)
    .optional(),
};

/** Validates a query to test: SQL, PromQL or LogQL with its options, or a search. */
const testQuerySchema = z.discriminatedUnion('language', [
  z.object({ language: z.literal('sql'), sql: z.string().min(1).max(20_000) }),
  z.object({ language: z.literal('promql'), ...expressionOptions }),
  z.object({ language: z.literal('logql'), ...expressionOptions }),
  z.object({
    language: z.literal('search'),
    index: z.string().min(1).max(500),
    body: z.record(z.string(), z.unknown()),
  }),
  z.object({
    language: z.literal('http'),
    method: z.enum(['GET', 'POST']).default('GET'),
    path: z.string().min(1).max(2000),
    query: z.record(z.string(), z.string()).optional(),
    body: z.record(z.string(), z.unknown()).optional(),
    extract: z
      .object({
        rows: z.string().default(''),
        fields: z
          .array(
            z.object({
              name: z.string(),
              pointer: z.string(),
              type: z.enum(['time', 'number', 'string', 'boolean']).optional(),
              unit: z.enum(['s', 'ms']).optional(),
            }),
          )
          .optional(),
      })
      .default({ rows: '' }),
  }),
  z.object({
    language: z.literal('redis'),
    command: z.string().min(2).max(20),
    args: z.array(z.string().max(1000)).max(50).default([]),
  }),
  z.object({
    language: z.literal('mongodb'),
    collection: z.string().min(1).max(120),
    pipeline: z.array(z.record(z.string(), z.unknown())).max(50),
  }),
]);

/**
 * The variables of a test query as bindings.
 *
 * @param variables - Name to value, or to several values.
 * @returns The bindings.
 */
function bindingsOf(variables: Readonly<Record<string, string | string[]>> | undefined) {
  return Object.fromEntries(
    Object.entries(variables ?? {}).map(([name, value]) => [name, { value }]),
  );
}

/**
 * The tools that read schemas beyond the catalog: descriptions and sample values.
 *
 * @param context - The run.
 * @returns The tools.
 */
function schemaTools(context: RunContext) {
  const { modelView, signal } = context;
  return {
    describe: tool({
      description:
        'Describe the schema of a connector: tables and columns, or metrics and labels. Pass a scope to only list entities whose name contains it; large sources need one.',
      inputSchema: z.object({ connector: z.string(), scope: z.string().max(100).optional() }),
      execute: ({ connector, scope }) => modelView.describe(connector, scope, signal),
    }),
    sample_values: tool({
      description:
        'List distinct values of a field, such as label values of a metric. Refused for hidden or high-cardinality fields.',
      inputSchema: z.object({
        connector: z.string(),
        entity: z.string(),
        field: z.string(),
        limit: z.int().min(1).max(50).optional(),
      }),
      execute: ({ connector, entity, field, limit }) =>
        modelView.sample(connector, { entity, field }, limit ?? 20, signal),
    }),
  };
}

/**
 * The tool that test-runs a query.
 *
 * @param context - The run.
 * @param resolveTime - Turns a time expression into an instant.
 * @returns The tool.
 */
function testQueryTool(context: RunContext, resolveTime: (expression: string) => number) {
  const { modelView, signal } = context;
  return tool({
    description:
      "Run a query and see its result as your access level allows: shapes, row counts, and more at higher levels. Use it before putting a query in a dashboard. Write it as the connector kind's guide says (read_guide); variables and the time range work as in a panel.",
    inputSchema: z.object({
      connector: z.string(),
      query: testQuerySchema,
      variables: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
      time: z.object({ from: z.string(), to: z.string() }).optional(),
    }),
    execute: ({ connector, query, variables, time }) => {
      const range = time ?? defaultTestRange;
      const timeRange = {
        from: new Date(resolveTime(range.from)),
        to: new Date(resolveTime(range.to)),
      };
      const request = {
        refId: 'test',
        template: query,
        variables: bindingsOf(variables),
        timeRange,
        signal,
      };
      return modelView.testQuery(connector, request);
    },
  });
}

/**
 * Creates the data tools of a run.
 *
 * @param context - The run.
 * @param resolveTime - Turns a time expression into an instant, as dashboards do.
 * @returns The tools.
 */
export function dataTools(context: RunContext, resolveTime: (expression: string) => number) {
  return { ...schemaTools(context), test_query: testQueryTool(context, resolveTime) };
}
