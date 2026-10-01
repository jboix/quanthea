/**
 * The connector kit: everything a connector kind uses from the core. Kinds import this module and
 * nothing else from `_shared`, so its internals can change without breaking them.
 */
export {
  type AnyConnectorKind,
  type ConnectorIcon,
  type ConnectorInstance,
  defineConnector,
} from './connector-kind.ts';
export { ConnectorError } from './errors.ts';
export { createFrameBuilder } from './frame-builder.ts';
export { createHttpClient, type HttpClient, type HttpResponse } from './http.ts';
export {
  type BoundQuery,
  type ExecutionContext,
  type HttpField,
  type HttpQuery,
  type LogqlQuery,
  type MongodbQuery,
  mongodbRefusedKeys,
  type PromqlQuery,
  type QueryLanguage,
  queryLanguages,
  type RedisQuery,
  redisReadCommands,
  type SearchQuery,
  type SqlDialect,
  type SqlParameter,
  type SqlQuery,
  searchRatioScripts,
  sqlDialects,
  type TimeRange,
} from './queries.ts';
export type {
  FieldReference,
  HealthReport,
  SampleResult,
  SchemaEntity,
  SchemaField,
  SchemaSnapshot,
} from './schema.ts';
export { type SeriesData, seriesFrames } from './series-frames.ts';
