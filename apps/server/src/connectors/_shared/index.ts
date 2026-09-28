/**
 * The connector kit: everything a connector kind uses from the core. Kinds import this module and
 * nothing else from `_shared`, so its internals can change without breaking them.
 */
export {
  type AnyConnectorKind,
  type ConnectorInstance,
  defineConnector,
} from './connector-kind.ts';
export { ConnectorError } from './errors.ts';
export { createFrameBuilder } from './frame-builder.ts';
export {
  type BoundQuery,
  type ExecutionContext,
  type PromqlQuery,
  type QueryLanguage,
  queryLanguages,
  type SqlParameter,
  type SqlQuery,
  type TimeRange,
} from './queries.ts';
export type {
  FieldReference,
  HealthReport,
  SchemaEntity,
  SchemaField,
  SchemaSnapshot,
} from './schema.ts';
