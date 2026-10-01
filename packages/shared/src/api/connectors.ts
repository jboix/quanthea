/** Connector endpoints: kinds, configured connectors, connection tests and schemas. Admin only. */
import { z } from 'zod';
import {
  accessLevelSchema,
  connectorNameSchema,
  descriptionsSchema,
  guardrailsSchema,
  hiddenFieldsSchema,
  queryLanguageSchema,
} from '../connectors.ts';
import { defineEndpoint } from './contract.ts';

/** A JSON Schema document, as the server generates it from a kind's Zod schema. */
const jsonSchemaSchema = z.record(z.string(), z.unknown());

/** Validates a kind's logo: one SVG path on a 24×24 grid and its fill colour. */
const connectorIconSchema = z.object({
  path: z.string().regex(/^[MmZzLlHhVvCcSsQqTtAa0-9eE.,\s+-]+$/),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

/** Validates a connector kind as the add form needs it. */
export const connectorKindSchema = z.object({
  kind: z.string(),
  displayName: z.string(),
  /** The kind's logo, or `null` when it has none. */
  icon: connectorIconSchema.nullable(),
  /** Other names the add form finds the kind by. */
  aliases: z.array(z.string()),
  language: queryLanguageSchema,
  configSchema: jsonSchemaSchema,
  secretSchema: jsonSchemaSchema,
  /** The plugin that adds the kind, or `null` for a built-in kind. */
  plugin: z.object({ name: z.string(), version: z.string() }).nullable(),
});

/** A connector kind: its identifier, name, logo, query language and the JSON Schemas of its forms. */
export type ConnectorKindInfo = z.infer<typeof connectorKindSchema>;

/** Validates a connector in a list. */
export const connectorSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  accessLevel: accessLevelSchema,
  updatedAt: z.number(),
  /** The configuration file that manages it, when one does; it is read-only here then. */
  managedBy: z.string().optional(),
});

/** A connector in a list. */
export type ConnectorSummary = z.infer<typeof connectorSummarySchema>;

/** Validates a connector with its settings. Credentials are masked. */
export const connectorDetailSchema = connectorSummarySchema.extend({
  config: z.record(z.string(), z.unknown()),
  /** Where the connector points, such as `postgres://dash_ro@replica:5432/orders`, when known. */
  target: z.string().nullable(),
  secret: z.record(z.string(), z.string()),
  hiddenFields: hiddenFieldsSchema,
  guardrails: guardrailsSchema,
  descriptions: descriptionsSchema,
  createdAt: z.number(),
});

/** A connector with its settings. `secret` holds masked values, such as `••••••••`. */
export type ConnectorDetail = z.infer<typeof connectorDetailSchema>;

/** Validates a new connector. The kind validates `config` and `secret`. */
export const connectorInputSchema = z.object({
  name: connectorNameSchema,
  kind: z.string().min(1),
  config: z.record(z.string(), z.unknown()),
  secret: z.record(z.string(), z.unknown()),
  accessLevel: accessLevelSchema.default(2),
  hiddenFields: hiddenFieldsSchema.default([]),
  guardrails: guardrailsSchema.prefault({}),
  descriptions: descriptionsSchema.default({}),
});

/** Validates a change to a connector. Omitted fields keep their value; `secret` fields merge. */
export const connectorPatchSchema = z.object({
  name: connectorNameSchema.optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  secret: z.record(z.string(), z.unknown()).optional(),
  accessLevel: accessLevelSchema.optional(),
  hiddenFields: hiddenFieldsSchema.optional(),
  guardrails: guardrailsSchema.optional(),
  descriptions: descriptionsSchema.optional(),
});

/** Validates the result of a connection test. */
export const healthReportSchema = z.object({
  ok: z.boolean(),
  latencyMs: z.number(),
  message: z.string(),
  readOnly: z.boolean().nullable(),
});

/** Validates one field of the schema view. */
const schemaViewFieldSchema = z.object({
  name: z.string(),
  type: z.string(),
  description: z.string().optional(),
  /** The admin's description, when there is one. */
  adminDescription: z.string().optional(),
  hidden: z.boolean(),
  /** The estimated number of distinct values, when the source knows it. */
  distinctValues: z.number().optional(),
  /** What the model sees of the field: its values, its name only, or nothing. */
  modelSees: z.enum(['values', 'name', 'nothing']),
});

/** Validates one entity of the schema view. */
const schemaViewEntitySchema = z.object({
  name: z.string(),
  kind: z.enum(['table', 'view', 'metric', 'index', 'endpoint', 'collection']),
  description: z.string().optional(),
  adminDescription: z.string().optional(),
  rows: z.number().optional(),
  fields: z.array(schemaViewFieldSchema),
});

/** Validates the schema of a connector as admins see it, with what the model gets of each field. */
export const schemaViewSchema = z.object({
  readAt: z.number().nullable(),
  entities: z.array(schemaViewEntitySchema),
});

/** The schema of a connector as admins see it. */
export type SchemaView = z.infer<typeof schemaViewSchema>;

/** The path parameter of one connector. */
const connectorParams = z.object({ connectorId: z.string().min(1) });

/** Lists the connector kinds, with the JSON Schemas of their forms. */
export const listConnectorKindsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/connector-kinds',
  output: z.array(connectorKindSchema),
});

/** Lists the connectors. */
export const listConnectorsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/connectors',
  output: z.array(connectorSummarySchema),
});

/** Creates a connector. */
export const createConnectorEndpoint = defineEndpoint({
  method: 'POST',
  path: '/connectors',
  body: connectorInputSchema,
  output: connectorDetailSchema,
});

/** Reads a connector. */
export const getConnectorEndpoint = defineEndpoint({
  method: 'GET',
  path: '/connectors/:connectorId',
  params: connectorParams,
  output: connectorDetailSchema,
});

/** Changes a connector. */
export const updateConnectorEndpoint = defineEndpoint({
  method: 'PATCH',
  path: '/connectors/:connectorId',
  params: connectorParams,
  body: connectorPatchSchema,
  output: connectorDetailSchema,
});

/** Deletes a connector. */
export const deleteConnectorEndpoint = defineEndpoint({
  method: 'DELETE',
  path: '/connectors/:connectorId',
  params: connectorParams,
  output: z.object({ deleted: z.literal(true) }),
});

/** Tests the connection of a connector. */
export const testConnectorEndpoint = defineEndpoint({
  method: 'POST',
  path: '/connectors/:connectorId/test',
  params: connectorParams,
  output: healthReportSchema,
});

/** Reads the cached schema of a connector. */
export const getConnectorSchemaEndpoint = defineEndpoint({
  method: 'GET',
  path: '/connectors/:connectorId/schema',
  params: connectorParams,
  output: schemaViewSchema,
});

/** Reads the schema from the source again and caches it. */
export const refreshConnectorSchemaEndpoint = defineEndpoint({
  method: 'POST',
  path: '/connectors/:connectorId/schema',
  params: connectorParams,
  output: schemaViewSchema,
});
