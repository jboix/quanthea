/**
 * The Elasticsearch and OpenSearch connector kind: the search DSL over the REST API, search
 * endpoints only, with the row limit applied to the size and to the table, and the timeout sent to
 * the server.
 */
import type { Frame } from '@querent/shared';
import { z } from 'zod';
import {
  ConnectorError,
  type ConnectorInstance,
  defineConnector,
  type ExecutionContext,
  type FieldReference,
  type HealthReport,
  type SearchQuery,
} from '../_shared/index.ts';
import { aggregationsFrame } from './aggregations.ts';
import { createSearchApi, type SearchApi } from './api.ts';
import { describeIndices, mergedTypes } from './catalog.ts';
import { searchGuide } from './guide.ts';
import { hitsFrame } from './hits.ts';
import { elasticsearchIcon } from './icon.ts';

/** The configuration of a connector. */
const configSchema = z.object({
  url: z.url({ protocol: /^https?$/ }).meta({ title: 'URL', examples: ['https://search:9200'] }),
  auth: z.enum(['none', 'basic', 'api-key']).default('basic').meta({ title: 'Authentication' }),
  username: z
    .string()
    .trim()
    .optional()
    .meta({ title: 'Username', description: 'For basic authentication.' }),
  verifyTls: z.boolean().default(true).meta({ title: 'Verify the TLS certificate' }),
});

/** The credentials of a connector. */
const secretSchema = z.object({
  password: z
    .string()
    .optional()
    .meta({ title: 'Password', description: 'For basic authentication.' }),
  apiKey: z
    .string()
    .optional()
    .meta({ title: 'API key', description: 'Elasticsearch only: the encoded key.' }),
});

/** An index or pattern, as the binder allows them. */
const indexPattern = /^[a-z0-9*][a-z0-9_.*+-]{0,254}$/;

/** How long health checks, schema reads and samples may take, in milliseconds. */
const metadataTimeoutMs = 30_000;

/** How long an index's field types are reused, in milliseconds. */
const typesTtlMs = 5 * 60_000;

/** The parts of a search answer the connector reads. */
interface SearchAnswer {
  /** Whether a shard ran out of time. */
  readonly timed_out?: boolean;
  /** The documents. */
  readonly hits?: { readonly hits?: readonly { readonly _source?: Record<string, unknown> }[] };
  /** The aggregation results. */
  readonly aggregations?: Readonly<Record<string, unknown>>;
}

/** Field types by index expression, read from the mappings and kept a while. */
interface TypeCache {
  /**
   * The field types of the indices an expression covers.
   *
   * @param index - The index expression.
   * @param signal - The caller's signal.
   * @returns The types, by dotted path.
   */
  typesOf(index: string, signal: AbortSignal): Promise<ReadonlyMap<string, string>>;
}

/**
 * Creates the cache of field types.
 *
 * @param api - The API.
 * @returns The cache.
 */
function typeCache(api: SearchApi): TypeCache {
  const cache = new Map<string, { readonly at: number; readonly types: Map<string, string> }>();
  return {
    async typesOf(index, signal) {
      const cached = cache.get(index);
      if (cached && Date.now() - cached.at < typesTtlMs) return cached.types;
      const answer = await api.request<Parameters<typeof mergedTypes>[0]>({
        path: `/${index}/_mapping`,
        signal,
      });
      const types = mergedTypes(answer);
      cache.set(index, { at: Date.now(), types });
      return types;
    },
  };
}

/**
 * The Authorization header for the configured authentication.
 *
 * @param config - The configuration.
 * @param secret - The credentials.
 * @returns The headers, or the reason the credentials are incomplete.
 */
function authHeaders(
  config: z.output<typeof configSchema>,
  secret: z.output<typeof secretSchema>,
): Record<string, string> | string {
  if (config.auth === 'none') return {};
  if (config.auth === 'api-key')
    return secret.apiKey ? { Authorization: `ApiKey ${secret.apiKey}` } : 'Set the API key.';
  if (!config.username || secret.password === undefined)
    return 'Basic authentication needs a username and a password.';
  const encoded = Buffer.from(`${config.username}:${secret.password}`).toString('base64');
  return { Authorization: `Basic ${encoded}` };
}

/**
 * The body sent: the size capped by the row limit (0 with aggregations), and the timeout.
 *
 * @param query - The bound query.
 * @param context - The execution context.
 * @returns The body.
 */
function searchBody(query: SearchQuery, context: ExecutionContext): Record<string, unknown> {
  const aggregated = 'aggs' in query.body || 'aggregations' in query.body;
  const asked = typeof query.body.size === 'number' ? query.body.size : 10;
  const size = aggregated ? 0 : Math.max(0, Math.min(asked, Math.trunc(context.maxRows) + 1));
  return { ...query.body, size, timeout: `${Math.max(1, Math.trunc(context.timeoutMs))}ms` };
}

/**
 * Runs a bound search: a table of its aggregations when it has some, else of its documents.
 *
 * @param api - The API.
 * @param types - The field types cache.
 * @param query - The bound query.
 * @param context - The execution context.
 * @returns One frame.
 * @throws {ConnectorError} On any failure, and `timeout` when a shard ran out of time.
 */
async function execute(
  api: SearchApi,
  types: TypeCache,
  query: SearchQuery,
  context: ExecutionContext,
): Promise<Frame[]> {
  const started = performance.now();
  const { signal } = context;
  const server = await api.server(signal);
  const cancel =
    server.product === 'OpenSearch' ? { cancel_after_time_interval: `${context.timeoutMs}ms` } : {};
  const answer = await api.request<SearchAnswer>({
    method: 'POST',
    path: `/${query.index}/_search`,
    query: { allow_partial_search_results: 'false', ...cancel },
    body: searchBody(query, context),
    signal,
  });
  if (answer.timed_out) throw new ConnectorError('timeout', 'The search ran out of time.');
  const aggs = query.body.aggs ?? query.body.aggregations;
  const durationMs = () => performance.now() - started;
  if (aggs !== undefined)
    return [aggregationsFrame(aggs, answer.aggregations ?? {}, context, durationMs())];
  const fieldTypes = await types.typesOf(query.index, signal);
  return [hitsFrame(answer.hits?.hits ?? [], fieldTypes, context, durationMs())];
}

/**
 * Checks the connection and names the server. Neither server says whether a user could write
 * through a search, so the report does not either.
 *
 * @param api - The API.
 * @param signal - The caller's signal.
 * @returns The health report.
 */
async function test(api: SearchApi, signal: AbortSignal): Promise<HealthReport> {
  const started = performance.now();
  const latencyMs = (): number => Math.round(performance.now() - started);
  try {
    const server = await api.server(
      AbortSignal.any([signal, AbortSignal.timeout(metadataTimeoutMs)]),
    );
    const message = `${server.product} ${server.version}. The connector only searches.`;
    return { ok: true, latencyMs: latencyMs(), message, readOnly: null };
  } catch (error) {
    const message = error instanceof ConnectorError ? error.safeMessage : 'The test failed.';
    return { ok: false, latencyMs: latencyMs(), message, readOnly: null };
  }
}

/**
 * Reads distinct values of a field with a terms aggregation, after checking the index and the
 * field, so neither comes from the caller unchecked. A text field is read through its keyword.
 *
 * @param api - The API.
 * @param types - The field types cache.
 * @param field - The index pattern and the field.
 * @param limit - How many values at most.
 * @param signal - The caller's signal.
 * @returns The values and whether there are more.
 * @throws {ConnectorError} `not_found` when the index or the field does not exist.
 */
async function sampleValues(
  api: SearchApi,
  types: TypeCache,
  field: FieldReference,
  limit: number,
  signal: AbortSignal,
) {
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(metadataTimeoutMs)]);
  const known = indexPattern.test(field.entity)
    ? await types.typesOf(field.entity, bounded)
    : new Map<string, string>();
  const keyword = known.get(field.field) === 'text' ? `${field.field}.keyword` : field.field;
  if (!known.has(keyword) || known.get(keyword) === 'text')
    throw new ConnectorError('not_found', `Field "${field.entity}.${field.field}" does not exist.`);
  const answer = await api.request<{
    aggregations?: { values?: { buckets?: { key: unknown }[] } };
  }>({
    method: 'POST',
    path: `/${field.entity}/_search`,
    body: { size: 0, aggs: { values: { terms: { field: keyword, size: Math.trunc(limit) + 1 } } } },
    signal: bounded,
  });
  const all = (answer.aggregations?.values?.buckets ?? []).map((bucket) => String(bucket.key));
  return { values: all.slice(0, limit), complete: all.length <= limit };
}

/**
 * A connection whose settings are incomplete: every call says so.
 *
 * @param reason - What is missing.
 * @returns The connection.
 */
function misconfigured(reason: string): ConnectorInstance {
  const error = () => Promise.reject(new ConnectorError('authentication', reason));
  return {
    test: () => Promise.resolve({ ok: false, latencyMs: 0, message: reason, readOnly: null }),
    describe: error,
    sampleValues: error,
    execute: error,
    close: () => Promise.resolve(),
  };
}

/**
 * A URL without the user name and password it may carry.
 *
 * @param url - The URL.
 * @returns The URL without credentials.
 */
function withoutCredentials(url: string): string {
  const parsed = new URL(url);
  parsed.username = '';
  parsed.password = '';
  return parsed.href;
}

/** The Elasticsearch and OpenSearch connector kind. */
export const elasticsearchConnector = defineConnector({
  kind: 'elasticsearch',
  displayName: 'Elasticsearch / OpenSearch',
  icon: elasticsearchIcon,
  language: 'search',
  queryGuide: searchGuide,
  configSchema,
  secretSchema,
  describeTarget: (config) => withoutCredentials(config.url),
  open({ config, secret }): ConnectorInstance {
    const headers = authHeaders(config, secret);
    if (typeof headers === 'string') return misconfigured(headers);
    const api = createSearchApi({ url: config.url, headers, verifyTls: config.verifyTls });
    const types = typeCache(api);
    return {
      test: (signal) => test(api, signal),
      describe: (signal) =>
        describeIndices(api, AbortSignal.any([signal, AbortSignal.timeout(metadataTimeoutMs)])),
      sampleValues: (field, limit, signal) => sampleValues(api, types, field, limit, signal),
      execute: (query, context) =>
        query.language === 'search'
          ? execute(api, types, query, context)
          : Promise.reject(new ConnectorError('rejected', 'This connector runs searches only.')),
      close: () => Promise.resolve(),
    };
  },
});
