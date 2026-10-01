/**
 * The live kit, for the server: the object it hands each plugin, and the same functions for the
 * built-in kinds through the server's own kit module. Plugins never import this entry.
 */
import { z } from 'zod';
import { defineConnector } from './connector-kind.ts';
import { ConnectorError } from './errors.ts';
import { createFrameBuilder } from './frame-builder.ts';
import { createHttpClient } from './http.ts';
import { type ConnectorKit, kitVersion } from './kit.ts';
import { seriesFrames } from './series-frames.ts';

/** The kit every plugin receives. */
export const hostKit: ConnectorKit = Object.freeze({
  version: kitVersion,
  z,
  defineConnector,
  ConnectorError,
  createFrameBuilder,
  createHttpClient,
  seriesFrames,
});

export {
  type AnyConnectorKind,
  type ConnectorIcon,
  type ConnectorInstance,
  type ConnectorKind,
  defineConnector,
} from './connector-kind.ts';
export { ConnectorError, type ConnectorErrorCode } from './errors.ts';
export { createFrameBuilder } from './frame-builder.ts';
export { createHttpClient, type HttpClient, type HttpResponse } from './http.ts';
export { kitVersion } from './kit.ts';
export {
  type BoundQuery,
  type ExecutionContext,
  type HttpField,
  type HttpQuery,
  type LogqlQuery,
  type MongodbQuery,
  type PromqlQuery,
  type QueryLanguage,
  type RedisQuery,
  type SearchQuery,
  type SqlDialect,
  type SqlParameter,
  type SqlPlaceholderStyle,
  type SqlQuery,
  type SqlRowLimit,
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
