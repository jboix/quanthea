/**
 * Recipes: what a panel shows, named, so the agent asks for a recipe and the server writes the
 * queries. The built-in recipes cover common monitoring panels; saved recipes are queries with
 * typed placeholders that admins add. A thread uses the default set, a chosen set, or none.
 */
import { z } from 'zod';

/** How a panel's values read; percent expects a ratio from 0 to 1. */
export const panelUnits = [
  'number',
  'percent',
  'bytes',
  'seconds',
  'milliseconds',
  'per-second',
  'EUR',
  'USD',
] as const;

/** A panel unit. */
export type PanelUnit = (typeof panelUnits)[number];

/** A built-in recipe as the recipes screen and the agent's guide describe it. */
export interface QueryBuilder {
  /** The id the agent names it by. */
  readonly id: string;
  /** Its name. */
  readonly name: string;
  /** The query language it writes. */
  readonly language: 'sql' | 'promql';
  /** What it shows, in one sentence. */
  readonly description: string;
}

/** The built-in recipes. */
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
    description: "A counter's largest totals over the range, by label, as a table or bars.",
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
    description: 'A measure by the values of a column, as bars, a pie or a table.',
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

/** What a saved recipe's placeholder may hold, checked and quoted for its language. */
export const queryParamKinds = ['metric', 'label', 'table', 'column', 'value', 'duration'] as const;

/** A placeholder kind. */
export type QueryParamKind = (typeof queryParamKinds)[number];

/** Validates a placeholder of a saved recipe. */
const recipeParamSchema = z.strictObject({
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

/** Validates a saved recipe: a query with typed placeholders, and how its panel shows. */
export const savedQuerySchema = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'Use lowercase letters, digits and dashes.'),
    name: z.string().trim().min(1, 'Name the recipe.').max(60),
    description: z.string().trim().min(1, 'Say what it shows.').max(300),
    language: z.enum(['sql', 'promql']),
    query: z.string().min(1, 'Write the query.').max(10_000),
    params: z.array(recipeParamSchema).max(10).default([]),
    show: z.enum(['line', 'bar', 'category-bar', 'pie', 'stat', 'table']),
    unit: z.enum(panelUnits).default('number'),
    columns: z.array(z.string().min(1).max(200)).max(20).optional(),
  })
  .superRefine((recipe, context) => {
    const declared = new Set(recipe.params.map((param) => param.name));
    const used = placeholdersOf(recipe.query);
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
    if (recipe.show === 'table' && !recipe.columns?.length)
      context.addIssue({
        code: 'custom',
        path: ['columns'],
        message: 'A table needs its columns.',
      });
  });

/** A saved recipe. */
export type SavedQuery = z.infer<typeof savedQuerySchema>;

/** Validates the recipe settings: built-in recipes switched off, and the saved recipes. */
export const querySettingsSchema = z
  .strictObject({
    disabled: z.array(z.string().max(40)).max(20).default([]),
    saved: z.array(savedQuerySchema).max(50).default([]),
  })
  .refine(
    (settings) => new Set(settings.saved.map((recipe) => recipe.id)).size === settings.saved.length,
    { path: ['saved'], message: 'Recipe ids repeat.' },
  );

/** The recipe settings. */
export type QuerySettings = z.infer<typeof querySettingsSchema>;

/** Validates which recipes a thread uses: the default set, a chosen set, or none. */
export const threadQueriesSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('default') }),
  z.strictObject({ mode: z.literal('chosen'), ids: z.array(z.string().max(40)).max(60) }),
  z.strictObject({ mode: z.literal('free') }),
]);

/** The recipes a thread uses. */
export type ThreadQueries = z.infer<typeof threadQueriesSchema>;
