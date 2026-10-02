/**
 * The public kit: the types a connector plugin is written against, and the kit version. A plugin
 * imports types only from here; at load, quanthea passes it the live kit (`ConnectorKit`).
 *
 * ```ts
 * import type { ConnectorKit } from '@quanthea/plugin-kit';
 * export const kitVersion = 0;
 * export default function plugin(kit: ConnectorKit) {
 *   return { connectors: [kit.defineConnector({ kind: 'example', … })] };
 * }
 * ```
 */

export type {
  ConnectorIcon,
  ConnectorInstance,
  ConnectorKind,
  OpenOptions,
} from './connector-kind.ts';
export type { ConnectorError, ConnectorErrorCode } from './errors.ts';
export type { FrameBuilder, FrameBuilderOptions } from './frame-builder.ts';
export type { Field, FieldType, Frame } from './frames.ts';
export type { HttpClient, HttpClientOptions, HttpRequest, HttpResponse } from './http.ts';
export { type ConnectorKit, kitVersion, type Plugin, type PluginContributions } from './kit.ts';
export type {
  BoundQuery,
  ExecutionContext,
  HttpField,
  HttpQuery,
  LogqlQuery,
  MongodbQuery,
  PromqlQuery,
  QueryLanguage,
  RedisQuery,
  SearchQuery,
  SqlDialect,
  SqlParameter,
  SqlPlaceholderStyle,
  SqlQuery,
  SqlRowLimit,
  TimeRange,
} from './queries.ts';
export type {
  FieldReference,
  HealthReport,
  SampleResult,
  SchemaEntity,
  SchemaField,
  SchemaSnapshot,
} from './schema.ts';
export type { SeriesData } from './series-frames.ts';
