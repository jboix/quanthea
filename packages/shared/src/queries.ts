/**
 * Queries: the data side of a panel. Query builders write common monitoring queries from a few
 * fields; saved queries are templates with typed placeholders that admins add. Both return a table
 * of a known shape, which any chart query for that shape can draw. A thread uses the default set,
 * a chosen set, or none.
 */
import { z } from 'zod';
import { shapeKinds } from './dataset/contract.ts';

/** A query builder as the queries screen and the agent's guide describe it. */
export interface QueryBuilder {
  /** The id the agent names it by. */
  readonly id: string;
  /** Its name. */
  readonly name: string;
  /** The query language it writes. */
  readonly language: 'sql' | 'promql';
  /** What it returns, in one sentence. */
  readonly description: string;
}

/** The built-in queries. */
export const queryBuilders: readonly QueryBuilder[] = [
  {
    id: 'rate',
    name: 'Rate',
    language: 'promql',
    description: 'A counter per second, such as requests per second.',
  },
  {
    id: 'ratio',
    name: 'Ratio',
    language: 'promql',
    description:
      'The share of a counter that also matches "match", such as 5xx over all requests: error rates.',
  },
  {
    id: 'latency',
    name: 'Latency percentiles',
    language: 'promql',
    description: 'Percentiles of a histogram, with or without _bucket, such as p50, p95 and p99.',
  },
  {
    id: 'gauge',
    name: 'Gauge',
    language: 'promql',
    description: 'A current value, aggregated, such as memory in use.',
  },
  {
    id: 'top',
    name: 'Top values',
    language: 'promql',
    description: "A counter's largest totals over the range, by label, largest first.",
  },
  {
    id: 'sql-series',
    name: 'SQL over time',
    language: 'sql',
    description: 'A measure over time in buckets, one series per value of "by".',
  },
  {
    id: 'sql-breakdown',
    name: 'SQL breakdown',
    language: 'sql',
    description: 'A measure by the values of a column, largest first.',
  },
  {
    id: 'sql-stat',
    name: 'SQL number',
    language: 'sql',
    description: 'One number over the range, such as failed orders.',
  },
  {
    id: 'sql-rows',
    name: 'Latest rows',
    language: 'sql',
    description: 'The latest rows of a table, newest first.',
  },
];

/** What a saved query's placeholder may hold, checked and quoted for its language. */
export const queryParamKinds = ['metric', 'label', 'table', 'column', 'value', 'duration'] as const;

/** A placeholder kind. */
export type QueryParamKind = (typeof queryParamKinds)[number];

/** Validates a placeholder of a saved query. */
const queryParamSchema = z.strictObject({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,29}$/, 'Use lowercase letters, digits and _.'),
  kind: z.enum(queryParamKinds),
  description: z.string().max(200).default(''),
});

/** The placeholders a template names, such as `metric` in `rate({{metric}}[5m])`. */
const placeholder = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g;

/**
 * The placeholder names in a template.
 *
 * @param query - The template.
 * @returns The names, once each.
 */
export function placeholdersOf(query: string): string[] {
  return [...new Set([...query.matchAll(placeholder)].map((match) => match[1] ?? ''))];
}

/** Validates a saved query: a template with typed placeholders, and the shape of what it returns. */
export const savedQuerySchema = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'Use lowercase letters, digits and dashes.'),
    name: z.string().trim().min(1, 'Name the query.').max(60),
    description: z.string().trim().min(1, 'Say what it returns.').max(300),
    language: z.enum(['sql', 'promql']),
    query: z.string().min(1, 'Write the query.').max(10_000),
    params: z.array(queryParamSchema).max(10).default([]),
    shape: z.enum(shapeKinds).default('rows'),
  })
  .superRefine((query, context) => {
    const declared = new Set(query.params.map((param) => param.name));
    const used = placeholdersOf(query.query);
    const undeclared = used.filter((name) => !declared.has(name));
    if (undeclared.length > 0)
      context.addIssue({
        code: 'custom',
        path: ['query'],
        message: `Declare the placeholders ${undeclared.join(', ')}.`,
      });
    const unused = [...declared].filter((name) => !used.includes(name));
    if (unused.length > 0)
      context.addIssue({
        code: 'custom',
        path: ['params'],
        message: `Unused: ${unused.join(', ')}.`,
      });
  });

/** A saved query. */
export type SavedQuery = z.infer<typeof savedQuerySchema>;

/** Validates the query settings: builders switched off, and the saved queries. */
export const querySettingsSchema = z
  .strictObject({
    disabled: z.array(z.string().max(40)).max(20).default([]),
    saved: z.array(savedQuerySchema).max(50).default([]),
  })
  .refine(
    (settings) => new Set(settings.saved.map((query) => query.id)).size === settings.saved.length,
    { path: ['saved'], message: 'Query ids repeat.' },
  );

/** The query settings. */
export type QuerySettings = z.infer<typeof querySettingsSchema>;

/** Validates which queries a thread uses: the default set, a chosen set, or none. */
export const threadQueriesSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('default') }),
  z.strictObject({ mode: z.literal('chosen'), ids: z.array(z.string().max(40)).max(60) }),
  z.strictObject({ mode: z.literal('free') }),
]);

/** The queries a thread uses. */
export type ThreadQueries = z.infer<typeof threadQueriesSchema>;
