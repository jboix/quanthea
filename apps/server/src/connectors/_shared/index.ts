/**
 * The server's connector kit: the public kit (`@querent/plugin-kit`), which plugins receive at
 * load, and the policy lists only the built-in kinds and the binders use. Kinds import this module
 * and nothing else from `_shared`, so its internals can change without breaking them.
 */
export {
  type AnyConnectorKind,
  type BoundQuery,
  ConnectorError,
  type ConnectorIcon,
  type ConnectorInstance,
  createFrameBuilder,
  createHttpClient,
  defineConnector,
  type ExecutionContext,
  type FieldReference,
  type HealthReport,
  type HttpClient,
  type HttpField,
  type HttpQuery,
  type HttpResponse,
  type LogqlQuery,
  type MongodbQuery,
  type PromqlQuery,
  type QueryLanguage,
  type RedisQuery,
  type SampleResult,
  type SchemaEntity,
  type SchemaField,
  type SchemaSnapshot,
  type SearchQuery,
  type SeriesData,
  type SqlDialect,
  type SqlParameter,
  type SqlPlaceholderStyle,
  type SqlQuery,
  type SqlRowLimit,
  seriesFrames,
  type TimeRange,
} from '@querent/plugin-kit/host';
export {
  mongodbRefusedKeys,
  redisReadCommands,
  searchRatioScripts,
} from './policies.ts';
