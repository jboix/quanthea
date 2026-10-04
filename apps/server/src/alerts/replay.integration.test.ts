import { describe, expect, test } from 'bun:test';
import { alertSpecSchema } from '@quanthea/shared';
import {
  devIncidentStart,
  devPrometheus,
  integrationEnabled,
} from '../connectors/_shared/test/dev-sources.ts';
import { prometheusConnector } from '../connectors/prometheus/prometheus-connector.ts';
import { createQueryExecutor, type QuerySource } from '../query/executor.ts';
import { createResultCache } from '../query/result-cache.ts';
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
