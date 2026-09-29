/**
 * Recipe endpoints: admins switch built-in recipes on and off and save their own; editors list
 * the recipes a new thread may use.
 */
import { z } from 'zod';
import { querySettingsSchema, savedQuerySchema } from '../queries.ts';
import { panelSchema } from '../spec/dashboard.ts';
import { defineEndpoint } from './contract.ts';
import { panelRunSchema } from './panels.ts';

/** The recipe settings, for admins. */
export const getQuerySettingsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/settings/queries',
  output: querySettingsSchema,
});

/** Saves the recipe settings. */
export const saveQuerySettingsEndpoint = defineEndpoint({
  method: 'PUT',
  path: '/settings/queries',
  body: querySettingsSchema,
  output: querySettingsSchema,
});

/** A recipe as a new thread may choose it. */
export const queryChoiceSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  language: z.enum(['sql', 'promql']),
  /** Built into querent, or saved by an admin. */
  origin: z.enum(['built-in', 'saved']),
  /** Whether the default set includes it. */
  enabled: z.boolean(),
});

/** A recipe a thread may use. */
export type QueryChoice = z.infer<typeof queryChoiceSchema>;

/** The recipes a new thread may use, for editors. */
export const listQueryChoicesEndpoint = defineEndpoint({
  method: 'GET',
  path: '/queries',
  output: z.object({ recipes: z.array(queryChoiceSchema) }),
});

/** A field the agent fills when it asks for a built-in recipe. */
export const queryFieldSchema = z.object({
  name: z.string(),
  /** Such as `string`, `string[]` or `"line" | "stat"`. */
  type: z.string(),
  required: z.boolean(),
  /** The value when the agent leaves it out, if any. */
  default: z.unknown().optional(),
  description: z.string(),
});

/** How a built-in recipe works: what the agent fills, an example, and the queries it writes. */
export const queryGuideSchema = z.object({
  id: z.string(),
  fields: z.array(queryFieldSchema),
  /** A request the agent could send, without its title. */
  example: z.record(z.string(), z.unknown()),
  /** The queries the example becomes. */
  queries: z.array(z.string()),
});

/** How a built-in recipe works. */
export type QueryGuide = z.infer<typeof queryGuideSchema>;

/** A connector a preview can run on. */
export const previewConnectorSchema = z.object({
  name: z.string(),
  language: z.enum(['sql', 'promql']),
});

/** How the built-in recipes work, and the connectors a preview can run on, for admins. */
export const getQueryGuideEndpoint = defineEndpoint({
  method: 'GET',
  path: '/settings/queries/guide',
  output: z.object({
    recipes: z.array(queryGuideSchema),
    connectors: z.array(previewConnectorSchema),
  }),
});

/** How far back a preview looks. */
export const previewRanges = ['now-1h', 'now-6h', 'now-24h', 'now-7d', 'now-30d'] as const;

/** The outcome of a recipe preview. */
export const queryPreviewSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    panel: panelSchema,
    /** The queries the recipe wrote. */
    queries: z.array(z.string()),
    run: panelRunSchema,
  }),
  z.object({ ok: z.literal(false), message: z.string(), queries: z.array(z.string()) }),
]);

/** The outcome of a recipe preview. */
export type QueryPreview = z.infer<typeof queryPreviewSchema>;

/**
 * Expands one panel request as the agent would send it and test-runs it, for admins. A saved
 * recipe being edited comes with it, so it can be tried before it is saved.
 */
export const previewQueryEndpoint = defineEndpoint({
  method: 'POST',
  path: '/settings/queries/preview',
  body: z.object({
    panel: z.record(z.string(), z.unknown()),
    saved: savedQuerySchema.optional(),
    from: z.enum(previewRanges).default('now-24h'),
  }),
  output: queryPreviewSchema,
});
