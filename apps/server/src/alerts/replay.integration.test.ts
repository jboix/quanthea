import { describe, expect, test } from 'bun:test';
import { alertSpecSchema } from '@quanthea/shared';
import {
  devIncidentStart,
  devPostgres,
  devPrometheus,
  integrationEnabled,
} from '../connectors/_shared/test/dev-sources.ts';
import { postgresConnector } from '../connectors/postgres/postgres-connector.ts';
import { prometheusConnector } from '../connectors/prometheus/prometheus-connector.ts';
import { createQueryExecutor, type QuerySource } from '../query/executor.ts';
import { createResultCache } from '../query/result-cache.ts';
import { everythingShown } from '../query/scope/object-scope.ts';
import { replayAlert } from './replay.ts';

const minute = 60_000;
const incident = devIncidentStart();

describe.skipIf(!integrationEnabled)('replaying an alert against the dev Prometheus', () => {
  const prometheus = prometheusConnector.open({
    config: prometheusConnector.configSchema.parse(devPrometheus.config),
    secret: prometheusConnector.secretSchema.parse(devPrometheus.secret),
  });
  const source: QuerySource = {
    connectorId: 'prom',
    scope: everythingShown,
    version: 1,
    language: 'promql',
    instance: prometheus,
    guardrails: { timeoutMs: 10_000, maxRows: 50_000, maxRangeDays: 31 },
  };
  const dependencies = {
    openSource: () => Promise.resolve(source),
    executor: createQueryExecutor(createResultCache({ ttlMs: 1, maxEntries: 1 })),
  };
  const errors = 'http_requests_total{service="checkout-svc",env="prod",code=~"5.."}';
  const all = 'http_requests_total{service="checkout-svc",env="prod"}';
  const spec = alertSpecSchema.parse({
    specVersion: 1,
    title: 'Checkout 5xx share',
    query: {
      refId: 'A',
      connector: 'prometheus',
      language: 'promql',
      expr: `sum by (service) (rate(${errors}[1m])) / sum by (service) (rate(${all}[1m]))`,
    },
    condition: { kind: 'threshold', op: 'above', value: 0.01, for: '1m' },
    every: '1m',
    lookback: '5m',
    severity: 'critical',
    message: { title: '{alert} fires', body: '{value} for {series}.' },
  });

  test('would have fired once, at the start of the seeded incident', async () => {
    const window = { from: incident.getTime() - 60 * minute, to: incident.getTime() + 60 * minute };
    const replay = await replayAlert(dependencies, spec, window);
    if (!replay.replayable) throw new Error(replay.reason);
    const [series] = replay.series;
    expect(series?.labels).toEqual({ service: 'checkout-svc' });
    expect(series?.firings).toBe(1);
    const firedAt = series?.firing[0]?.from ?? 0;
    expect(firedAt).toBeGreaterThanOrEqual(incident.getTime() + minute);
    expect(firedAt).toBeLessThanOrEqual(incident.getTime() + 6 * minute);
  });
});

describe.skipIf(!integrationEnabled)('replaying an alert against the dev Postgres', () => {
  const postgres = postgresConnector.open({
    config: postgresConnector.configSchema.parse(devPostgres.config),
    secret: postgresConnector.secretSchema.parse(devPostgres.secret),
  });
  const source: QuerySource = {
    connectorId: 'orders',
    scope: everythingShown,
    version: 1,
    language: 'sql',
    dialect: 'postgres',
    instance: postgres,
    guardrails: { timeoutMs: 10_000, maxRows: 50_000, maxRangeDays: 31 },
  };
  const dependencies = {
    openSource: () => Promise.resolve(source),
    executor: createQueryExecutor(createResultCache({ ttlMs: 1, maxEntries: 1 })),
  };
  const window = { from: incident.getTime() - 60 * minute, to: incident.getTime() + 60 * minute };

  /**
   * An alert on the failed orders, with its time bucketed as given.
   *
   * @param bucket - The bucket expression.
   * @param lookback - The window of each check.
   * @returns The spec.
   */
  function failedOrders(bucket: string, lookback: string) {
    const sql = `SELECT ${bucket} AS time, count(*) AS failed FROM orders WHERE status = 'failed' AND created_at BETWEEN :__from AND :__to GROUP BY 1 ORDER BY 1`;
    return alertSpecSchema.parse({
      specVersion: 1,
      title: 'Failed orders',
      query: { refId: 'A', connector: 'orders', language: 'sql', sql },
      value: { reduce: 'max' },
      condition: { kind: 'threshold', op: 'above', value: 1000, for: '0m' },
      every: '1m',
      lookback,
      severity: 'warning',
      message: { title: '{alert} fires', body: '{value}' },
    });
  }

  /**
   * The gaps between the buckets a replay's query returned, read from its points.
   *
   * @param spec - The spec.
   * @returns The largest bucket count the replay saw, to compare two bucket widths.
   */
  async function peakOf(spec: ReturnType<typeof failedOrders>): Promise<number> {
    const replay = await replayAlert(dependencies, spec, window);
    if (!replay.replayable) throw new Error(replay.reason);
    const values = replay.series.flatMap((series) => series.points.map((point) => point.value));
    return Math.max(...values.map((value) => value ?? 0));
  }

  test('buckets by the interval of its lookback over the whole replay, as text or seconds', async () => {
    const asText = await peakOf(
      failedOrders('date_bin(:__interval::interval, created_at, :__from)', '10m'),
    );
    const asSeconds = await peakOf(
      failedOrders(
        'to_timestamp(floor(extract(epoch FROM created_at) / :__interval_s) * :__interval_s)',
        '10m',
      ),
    );
    const byMinute = await peakOf(failedOrders("date_trunc('minute', created_at)", '10m'));
    expect(asText).toBeGreaterThan(0);
    // A lookback of 10 minutes takes 1m: the buckets are a minute wide over the two hours too.
    expect(asText).toBeLessThanOrEqual(byMinute * 2);
    expect(asSeconds).toBe(byMinute);
  });

  test('takes wider buckets with a longer lookback', async () => {
    const fine = await peakOf(
      failedOrders('date_bin(:__interval::interval, created_at, :__from)', '10m'),
    );
    const wide = await peakOf(
      failedOrders('date_bin(:__interval::interval, created_at, :__from)', '1d'),
    );
    expect(wide).toBeGreaterThan(fine);
  });
});
