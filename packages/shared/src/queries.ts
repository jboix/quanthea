/**
 * Queries: the data side of a panel. Saved queries are templates with typed placeholders that
 * admins add, in any query language, beside the query builders. Both return a table of a known
 * shape, which any chart for that shape can draw. A thread uses the default set, a chosen set, or
 * none.
 */

import { type QueryLanguage, queryLanguageSchema } from '@quanthea/plugin-kit/contract';
import { z } from 'zod';
import { shapeKinds } from './dataset/contract.ts';

/** The languages whose saved query is the JSON of its template, placeholders in its strings. */
export const jsonQueryLanguages: ReadonlySet<QueryLanguage> = new Set([
  'search',
  'http',
  'mongodb',
]);

/**
 * Whether a saved query's text is a JSON object, as its language needs.
 *
 * @param language - The language.
 * @param text - The text.
 * @returns `true` when it needs no JSON or is a JSON object.
 */
function jsonAsNeeded(language: QueryLanguage, text: string): boolean {
  if (!jsonQueryLanguages.has(language)) return true;
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  } catch {
    return false;
  }
}

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
    language: queryLanguageSchema,
    query: z.string().min(1, 'Write the query.').max(10_000),
    params: z.array(queryParamSchema).max(10).default([]),
    shape: z.enum(shapeKinds).default('rows'),
  })
  .superRefine((query, context) => {
    if (!jsonAsNeeded(query.language, query.query))
      context.addIssue({
        code: 'custom',
        path: ['query'],
        message: 'Write the query as a JSON object, with each placeholder in quotes: "{{name}}".',
      });
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
    disabled: z.array(z.string().max(40)).max(100).default([]),
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
  z.strictObject({ mode: z.literal('chosen'), ids: z.array(z.string().max(40)).max(100) }),
  z.strictObject({ mode: z.literal('free') }),
]);

/** The queries a thread uses. */
export type ThreadQueries = z.infer<typeof threadQueriesSchema>;
