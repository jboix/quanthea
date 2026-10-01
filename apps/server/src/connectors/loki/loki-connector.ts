/**
 * The Loki connector kind: LogQL over the HTTP API, read endpoints only. A log query gives a table
 * of lines; a metric query gives series, as Prometheus does.
 */
import type { Frame } from '@quanthea/shared';
import { z } from 'zod';
import {
  ConnectorError,
  type ConnectorInstance,
  defineConnector,
  type ExecutionContext,
  type FieldReference,
  type HealthReport,
  type LogqlQuery,
  type SeriesData,
  seriesFrames,
} from '../_shared/index.ts';
import { createLokiApi, type LokiApi } from './api.ts';
import { catalogWindow, describeLoki, labelPattern, streamLabels } from './catalog.ts';
import { lokiGuide } from './guide.ts';
import { lokiIcon } from './icon.ts';
import { type Stream, streamsFrame } from './streams.ts';

/** The configuration of a Loki connector. */
const configSchema = z.object({
  url: z.url({ protocol: /^https?$/ }).meta({ title: 'URL', examples: ['http://loki:3100'] }),
  tenant: z
    .string()
    .trim()
    .optional()
    .meta({ title: 'Tenant', description: 'Sent as X-Scope-OrgID, for a multi-tenant Loki.' }),
  auth: z.enum(['none', 'bearer', 'basic']).default('none').meta({ title: 'Authentication' }),
  username: z
    .string()
    .trim()
    .optional()
    .meta({ title: 'Username', description: 'For basic authentication.' }),
  verifyTls: z.boolean().default(true).meta({ title: 'Verify the TLS certificate' }),
});

/** The credentials of a Loki connector. */
const secretSchema = z.object({
  password: z
    .string()
    .optional()
    .meta({ title: 'Password', description: 'For basic authentication.' }),
  token: z
    .string()
    .optional()
    .meta({ title: 'Bearer token', description: 'For bearer authentication.' }),
});

/** The most lines Loki returns to one query by default (`max_entries_limit_per_query`). */
const maxLines = 5000;

/** How long health checks, schema reads and samples may take, in milliseconds. */
const metadataTimeoutMs = 30_000;

/** The `data` of a query answer: lines for a log query, series for a metric query. */
type QueryData =
  | SeriesData
  | { readonly resultType: 'streams'; readonly result: readonly Stream[] };

/**
 * A time in nanoseconds, as Loki takes it.
 *
 * @param time - The time.
 * @returns Epoch nanoseconds as text.
 */
function nanoseconds(time: Date): string {
  return `${BigInt(time.getTime()) * 1_000_000n}`;
}

/**
 * The headers for the configured tenant and authentication.
 *
 * @param config - The configuration.
 * @param secret - The credentials.
 * @returns The headers, or the reason the credentials are incomplete.
 */
function requestHeaders(
  config: z.output<typeof configSchema>,
  secret: z.output<typeof secretSchema>,
): Record<string, string> | string {
  const tenant = config.tenant ? { 'X-Scope-OrgID': config.tenant } : {};
  if (config.auth === 'none') return tenant;
  if (config.auth === 'bearer')
    return secret.token ? { ...tenant, Authorization: `Bearer ${secret.token}` } : 'Set the token.';
  if (!config.username || secret.password === undefined)
    return 'Basic authentication needs a username and a password.';
  const encoded = Buffer.from(`${config.username}:${secret.password}`).toString('base64');
  return { ...tenant, Authorization: `Basic ${encoded}` };
}

/**
 * Runs a LogQL query: instant at the end of the range, or over the range with the query's step.
 *
 * @param api - The API.
 * @param query - The bound query.
 * @param context - The execution context.
 * @returns The frames: one table of lines, or the series.
 */
async function execute(
  api: LokiApi,
  query: LogqlQuery,
  context: ExecutionContext,
): Promise<Frame[]> {
  const started = performance.now();
  const limit = Math.min(Math.trunc(context.maxRows) + 1, maxLines);
  const { from, to } = context.timeRange;
  const common = { query: query.expr, limit: String(limit) };
  const answer = query.instant
    ? await api.get<{ data: QueryData }>(
        '/loki/api/v1/query',
        { ...common, time: nanoseconds(to) },
        context.signal,
      )
    : await api.get<{ data: QueryData }>(
        '/loki/api/v1/query_range',
        {
          ...common,
          start: nanoseconds(from),
          end: nanoseconds(to),
          step: `${query.stepSeconds}s`,
        },
        context.signal,
      );
  const durationMs = performance.now() - started;
  if (answer.data.resultType !== 'streams') return seriesFrames(answer.data, context, durationMs);
  const lines = answer.data.result.reduce((total, stream) => total + stream.values.length, 0);
  const capped = lines >= limit && limit <= context.maxRows;
  return [streamsFrame(answer.data.result, context, durationMs, capped)];
}

/**
 * Checks that Loki answers.
 *
 * @param api - The API.
 * @param signal - The caller's signal.
 * @returns The health report. Loki cannot tell whether the credentials could push, so `readOnly`
 *   is `null`; the connector only calls read endpoints.
 */
async function test(api: LokiApi, signal: AbortSignal): Promise<HealthReport> {
  const started = performance.now();
  const latencyMs = (): number => Math.round(performance.now() - started);
  try {
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(metadataTimeoutMs)]);
    const info = await api.get<{ version?: string }>('/loki/api/v1/status/buildinfo', {}, bounded);
    const message = `Loki ${info.version ?? '?'}. The connector calls read endpoints only.`;
    return { ok: true, latencyMs: latencyMs(), message, readOnly: null };
  } catch (error) {
    const message = error instanceof ConnectorError ? error.safeMessage : 'Loki cannot be reached.';
    return { ok: false, latencyMs: latencyMs(), message, readOnly: null };
  }
}

/**
 * Reads distinct values of a stream label, or of a field Loki detects in the lines.
 *
 * @param api - The API.
 * @param field - The entity, `logs`, and the label or field.
 * @param limit - How many values at most.
 * @param signal - The caller's signal.
 * @returns The values and whether there are more.
 * @throws {ConnectorError} `not_found` for another entity or a name Loki does not allow.
 */
async function sampleValues(
  api: LokiApi,
  field: FieldReference,
  limit: number,
  signal: AbortSignal,
) {
  if (field.entity !== 'logs' || !labelPattern.test(field.field))
    throw new ConnectorError('not_found', `Field "${field.entity}.${field.field}" does not exist.`);
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(metadataTimeoutMs)]);
  const labels = await streamLabels(api, bounded);
  const values = labels.includes(field.field)
    ? (
        await api.get<{ data?: string[] }>(
          `/loki/api/v1/label/${field.field}/values`,
          catalogWindow(),
          bounded,
        )
      ).data
    : (
        await api.get<{ values?: string[] }>(
          `/loki/api/v1/detected_field/${field.field}/values`,
          { ...catalogWindow(), query: `{${labels[0] ?? 'service_name'}=~".+"}` },
          bounded,
        )
      ).values;
  const all = values ?? [];
  return { values: all.slice(0, limit), complete: all.length <= limit };
}

/**
 * The instance of a connector whose credentials are incomplete: every call reports why.
 *
 * @param reason - What is missing.
 * @returns The instance.
 */
function misconfigured(reason: string): ConnectorInstance {
  const error = (): Promise<never> => Promise.reject(new ConnectorError('authentication', reason));
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

/** The Loki connector kind. */
export const lokiConnector = defineConnector({
  kind: 'loki',
  displayName: 'Loki',
  icon: lokiIcon,
  language: 'logql',
  queryGuide: lokiGuide,
  configSchema,
  secretSchema,
  describeTarget: (config) => withoutCredentials(config.url),
  open({ config, secret }): ConnectorInstance {
    const headers = requestHeaders(config, secret);
    if (typeof headers === 'string') return misconfigured(headers);
    const api = createLokiApi({ url: config.url, headers, verifyTls: config.verifyTls });
    return {
      test: (signal) => test(api, signal),
      describe: (signal) =>
        describeLoki(api, AbortSignal.any([signal, AbortSignal.timeout(metadataTimeoutMs)])),
      sampleValues: (field, limit, signal) => sampleValues(api, field, limit, signal),
      execute: (query, context) =>
        query.language === 'logql'
          ? execute(api, query, context)
          : Promise.reject(
              new ConnectorError('rejected', 'Loki connectors run LogQL queries only.'),
            ),
      close: () => Promise.resolve(),
    };
  },
});
