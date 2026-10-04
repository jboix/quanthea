/**
 * The server's connector kit: the public kit (`@quanthea/plugin-kit`), which plugins receive at
 * load, and the policy lists only the built-in kinds and the binders use. Kinds import this module
 * and nothing else from `_shared`, so its internals can change without breaking them.
 */
import type { AnyConnectorKind } from '@quanthea/plugin-kit/host';

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
  hostKit,
  isMetadataAddress,
  kindProblems,
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
} from '@quanthea/plugin-kit/host';
/** Where a connector kind comes from, when a plugin added it. */
export interface PluginOrigin {
  /** The plugin's package name. */
  readonly name: string;
  /** The plugin's version. */
  readonly version: string;
}

/** A kind the server offers: a built-in one, or one a plugin added, with its origin. */
export type RegisteredKind = AnyConnectorKind & { readonly plugin?: PluginOrigin };

export {
  mongodbRefusedKeys,
  redisReadCommands,
  searchRatioScripts,
} from './policies.ts';
