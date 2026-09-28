/**
 * Query templates in a spec. A template names its connector and is written in the connector's
 * language; the server binds the variables. OpenSearch and HTTP templates arrive with their
 * connectors.
 */
import { z } from 'zod';
import { connectorNameSchema } from '../connectors.ts';
import { refIdSchema } from './names.ts';

/** Validates a PromQL template: an expression, and whether it is instant and its minimum step. */
const promqlQuerySchema = z.strictObject({
  connector: connectorNameSchema,
  language: z.literal('promql'),
  expr: z.string().min(1).max(10_000),
  step: z
    .string()
    .regex(/^\d{1,5}[smhd]$/, 'Use a duration such as 15s, 1m or 1h.')
    .optional(),
  instant: z.boolean().optional(),
});

/** Validates a SQL template: one read statement with `:name` variables. */
const sqlQuerySchema = z.strictObject({
  connector: connectorNameSchema,
  language: z.literal('sql'),
  sql: z.string().min(1).max(20_000),
});

/** Validates a query template without a refId, as a query-backed variable uses it. */
export const queryTemplateSchema = z.discriminatedUnion('language', [
  promqlQuerySchema,
  sqlQuerySchema,
]);

/** A query template without a refId. */
export type QueryTemplate = z.infer<typeof queryTemplateSchema>;

/** Validates a panel or annotation query: a template with the refId its view binds to. */
export const panelQuerySchema = z.discriminatedUnion('language', [
  promqlQuerySchema.extend({ refId: refIdSchema }),
  sqlQuerySchema.extend({ refId: refIdSchema }),
]);

/** A panel or annotation query. */
export type PanelQuery = z.infer<typeof panelQuerySchema>;
