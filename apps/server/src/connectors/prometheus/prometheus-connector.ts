/** The Prometheus connector kind: PromQL over the HTTP API, read endpoints only. */

import type { Frame } from '@querent/shared';
import { z } from 'zod';
import {
  ConnectorError,
  type ConnectorInstance,
  defineConnector,
  type ExecutionContext,
  type FieldReference,
  type HealthReport,
  type PromqlQuery,
  type SeriesData,
  seriesFrames,
} from '../_shared/index.ts';
import { createPrometheusApi, type PrometheusApi } from './api.ts';
import { describePrometheus, metricSelector } from './catalog.ts';
import { prometheusGuide } from './guide.ts';
import { prometheusIcon } from './icon.ts';

/** The configuration of a Prometheus connector. */
const configSchema = z.object({
  url: z.url({ protocol: /^https?$/ }).meta({
    title: 'URL',
    examples: ['http://prometheus:9090'],
  }),
  auth: z.enum(['none', 'bearer', 'basic']).default('none').meta({ title: 'Authentication' }),
  username: z
    .string()
    .trim()
    .optional()
    .meta({ title: 'Username', description: 'For basic authentication.' }),
  verifyTls: z.boolean().default(true).meta({ title: 'Verify the TLS certificate' }),
});

/** The credentials of a Prometheus connector. */
const secretSchema = z.object({
  token: z
    .string()
    .optional()
    .meta({ title: 'Bearer token', description: 'For bearer authentication.' }),
  password: z
    .string()
    .optional()
    .meta({ title: 'Password', description: 'For basic authentication.' }),
});

/** Label and metric names, as Prometheus allows them. */
const namePattern = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;

/**
 * The Authorization header for the configured authentication.
 *
 * @param config - The parsed configuration.
 * @param secret - The parsed credentials.
 * @returns The headers, or the reason the credentials are incomplete.
 */
function authHeaders(
  config: z.output<typeof configSchema>,
  secret: z.output<typeof secretSchema>,
): Record<string, string> | string {
  if (config.auth === 'none') return {};
  if (config.auth === 'bearer') {
    return secret.token
      ? { Authorization: `Bearer ${secret.token}` }
      : 'Bearer authentication needs a token.';
  }
  if (!config.username || secret.password === undefined)
    return 'Basic authentication needs a username and a password.';
  const encoded = Buffer.from(`${config.username}:${secret.password}`).toString('base64');
  return { Authorization: `Basic ${encoded}` };
}

/**
 * Formats a time for the API.
 *
 * @param time - The time.
 * @returns Unix seconds with milliseconds.
 */
function unixSeconds(time: Date): string {
  return (time.getTime() / 1000).toFixed(3);
}

/**
 * Runs a PromQL query: instant at the end of the range, or over the range with the query's step.
 *
 * @param api - The API client.
 * @param query - The bound query.
 * @param context - The execution context.
 * @returns The frames.
 */
async function execute(
  api: PrometheusApi,
  query: PromqlQuery,
  context: ExecutionContext,
): Promise<Frame[]> {
  const started = performance.now();
  const timeout = `${Math.max(1, Math.ceil(context.timeoutMs / 1000))}s`;
  const { from, to } = context.timeRange;
  const result = query.instant
    ? await api.get<SeriesData>(
        '/api/v1/query',
        { query: query.expr, time: unixSeconds(to), timeout },
        context.signal,
      )
    : await api.get<SeriesData>(
        '/api/v1/query_range',
        {
          query: query.expr,
          start: unixSeconds(from),
          end: unixSeconds(to),
          step: `${query.stepSeconds}s`,
          timeout,
        },
        context.signal,
      );
  return seriesFrames(result.data, context, performance.now() - started);
}

/**
 * Checks that the server answers.
 *
 * @param api - The API client.
 * @param signal - The caller's signal.
 * @returns The health report. Prometheus cannot tell whether credentials could reach admin
 *   endpoints, so `readOnly` is `null`; the connector only calls read endpoints.
 */
async function test(api: PrometheusApi, signal: AbortSignal): Promise<HealthReport> {
  const started = performance.now();
  const latencyMs = (): number => Math.round(performance.now() - started);
  try {
    const info = await api.get<{ version: string }>('/api/v1/status/buildinfo', {}, signal);
    const message = `Prometheus ${info.data.version}. The connector calls read endpoints only.`;
    return { ok: true, latencyMs: latencyMs(), message, readOnly: null };
  } catch (error) {
    const message =
      error instanceof ConnectorError ? error.safeMessage : 'Prometheus cannot be reached.';
    return { ok: false, latencyMs: latencyMs(), message, readOnly: null };
  }
}

/**
 * Reads distinct values of a label of one metric.
 *
 * @param api - The API client.
 * @param field - The metric and the label.
 * @param limit - How many values at most.
 * @param signal - The caller's signal.
 * @returns The values and whether there are more.
 * @throws {ConnectorError} `not_found` when the metric or label name is not a valid name.
 */
async function sampleValues(
  api: PrometheusApi,
  field: FieldReference,
  limit: number,
  signal: AbortSignal,
) {
  if (!namePattern.test(field.entity) || !namePattern.test(field.field)) {
    throw new ConnectorError('not_found', `Label "${field.entity}.${field.field}" does not exist.`);
  }
  const result = await api.get<string[]>(
    `/api/v1/label/${field.field}/values`,
    { 'match[]': metricSelector(field.entity), limit: String(Math.trunc(limit) + 1) },
    signal,
  );
  return { values: result.data.slice(0, limit), complete: result.data.length <= limit };
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

/** The Prometheus connector kind. */
export const prometheusConnector = defineConnector({
  kind: 'prometheus',
  displayName: 'Prometheus',
  icon: prometheusIcon,
  language: 'promql',
  queryGuide: prometheusGuide,
  configSchema,
  secretSchema,
  describeTarget: (config) => withoutCredentials(config.url),
  open({ config, secret }): ConnectorInstance {
    const headers = authHeaders(config, secret);
    if (typeof headers === 'string') return misconfigured(headers);
    const api = createPrometheusApi({ url: config.url, headers, verifyTls: config.verifyTls });
    return {
      test: (signal) => test(api, signal),
      describe: (signal) => describePrometheus(api, signal),
      sampleValues: (field, limit, signal) => sampleValues(api, field, limit, signal),
      execute: (query, context) =>
        query.language === 'promql'
          ? execute(api, query, context)
          : Promise.reject(
              new ConnectorError('rejected', 'Prometheus connectors run PromQL queries only.'),
            ),
      close: () => Promise.resolve(),
    };
  },
});
