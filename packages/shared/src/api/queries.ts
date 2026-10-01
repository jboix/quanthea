/**
 * Query endpoints: admins switch query builders on and off and save their own queries; editors
 * list the queries a new thread may use.
 */

import { queryLanguageSchema } from '@quanthea/plugin-kit/contract';
import { z } from 'zod';
import { shapeKinds } from '../dataset/contract.ts';
import { querySettingsSchema, savedQuerySchema } from '../queries.ts';
import { panelSchema } from '../spec/dashboard.ts';
import { defineEndpoint } from './contract.ts';
import { panelRunSchema } from './panels.ts';

/** The query settings, for admins. */
export const getQuerySettingsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/settings/queries',
  output: querySettingsSchema,
});

/** Saves the query settings. */
export const saveQuerySettingsEndpoint = defineEndpoint({
  method: 'PUT',
  path: '/settings/queries',
  body: querySettingsSchema,
  output: querySettingsSchema,
});

/** A query builder or saved query as a new thread may choose it. */
export const queryChoiceSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  language: queryLanguageSchema,
  /** Built into quanthea, or saved by an admin. */
  origin: z.enum(['built-in', 'saved']),
  /** Whether the default set includes it. */
  enabled: z.boolean(),
});

/** A query a thread may use. */
export type QueryChoice = z.infer<typeof queryChoiceSchema>;

/** The queries a new thread may use, for editors. */
export const listQueryChoicesEndpoint = defineEndpoint({
  method: 'GET',
  path: '/queries',
  output: z.object({ queries: z.array(queryChoiceSchema) }),
});

/** A field the agent fills when it asks for a query builders. */
export const queryFieldSchema = z.object({
  name: z.string(),
  /** Such as `string`, `string[]` or `"line" | "stat"`. */
  type: z.string(),
  required: z.boolean(),
  /** The value when the agent leaves it out, if any. */
  default: z.unknown().optional(),
  description: z.string(),
});

/** How a query builders works: what the agent fills, an example, and the queries it writes. */
export const queryGuideSchema = z.object({
  id: z.string(),
  fields: z.array(queryFieldSchema),
  /** A request the agent could send, without its title. */
  example: z.record(z.string(), z.unknown()),
  /** The queries the example becomes. */
  queries: z.array(z.string()),
  /** What the queries return, and a chart that suits it. */
  output: z.object({
    shape: z.enum(shapeKinds),
    columns: z.array(z.string()),
    chart: z.string(),
  }),
});

/** How a query builder works. */
export type QueryGuide = z.infer<typeof queryGuideSchema>;

/** A connector a preview can run on. */
export const previewConnectorSchema = z.object({
  name: z.string(),
  language: queryLanguageSchema,
});

/** How the query builders work, and the connectors a preview can run on, for admins. */
export const getQueryGuideEndpoint = defineEndpoint({
  method: 'GET',
  path: '/settings/queries/guide',
  output: z.object({
    builders: z.array(queryGuideSchema),
    connectors: z.array(previewConnectorSchema),
  }),
});

/** How far back a preview looks. */
export const previewRanges = ['now-1h', 'now-6h', 'now-24h', 'now-7d', 'now-30d'] as const;

/** The outcome of a query preview. */
export const queryPreviewSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    panel: panelSchema,
    /** The queries written. */
    queries: z.array(z.string()),
    run: panelRunSchema,
    /** The columns the result has, for choosing roles. */
    columns: z.array(z.string()),
  }),
  z.object({ ok: z.literal(false), message: z.string(), queries: z.array(z.string()) }),
]);

/** The outcome of a query preview. */
export type QueryPreview = z.infer<typeof queryPreviewSchema>;

/**
 * Builds one data request as the agent would send it, runs it, and draws it with a chart recipe,
 * the one that suits its data unless another is named, for admins. A saved query being edited
 * comes with it, so it can be tried before it is saved.
 */
export const previewQueryEndpoint = defineEndpoint({
  method: 'POST',
  path: '/settings/queries/preview',
  body: z.object({
    data: z.record(z.string(), z.unknown()),
    chart: z.record(z.string(), z.unknown()).optional(),
    saved: savedQuerySchema.optional(),
    from: z.enum(previewRanges).default('now-24h'),
  }),
  output: queryPreviewSchema,
});
