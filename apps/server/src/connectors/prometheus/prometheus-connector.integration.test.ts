import { describe, expect, test } from 'bun:test';
import type { ExecutionContext } from '../_shared/index.ts';
import { testConnectorConformance } from '../_shared/test/conformance.ts';
import {
  devIncidentStart,
  devPrometheus,
  integrationEnabled,
} from '../_shared/test/dev-sources.ts';
import { prometheusConnector } from './prometheus-connector.ts';

const incident = devIncidentStart();
const timeRange = {
  from: new Date(incident.getTime() - 30 * 60_000),
  to: new Date(incident.getTime() + 60 * 60_000),
};

testConnectorConformance(prometheusConnector, {
  config: devPrometheus.config,
  secret: devPrometheus.secret,
  query: {
    language: 'promql',
    expr: 'sum by (service) (rate(http_requests_total{env="prod"}[1m]))',
    instant: false,
    stepSeconds: 60,
  },
  invalidQuery: { language: 'promql', expr: 'sum(', instant: true, stepSeconds: 60 },
  sampleField: { entity: 'http_requests_total', field: 'service' },
  timeRange,
  live: integrationEnabled,
});

describe.skipIf(!integrationEnabled)('prometheus connector against the dev server', () => {
  const connection = prometheusConnector.open({
    config: prometheusConnector.configSchema.parse(devPrometheus.config),
    secret: prometheusConnector.secretSchema.parse(devPrometheus.secret),
  });

  /**
   * An execution context.
   *
   * @param range - The time range.
   * @returns The context.
   */
  const context = (range: ExecutionContext['timeRange']): ExecutionContext => ({
    refId: 'A',
    signal: AbortSignal.timeout(10_000),
    timeoutMs: 10_000,
    maxRows: 5000,
    timeRange: range,
  });

  test('shows the checkout incident: 5xx ratio near 8.4% fifteen minutes after the deploy', async () => {
    const at = new Date(incident.getTime() + 15 * 60_000);
    const [frame] = await connection.execute(
      {
        language: 'promql',
        expr: 'sum by (service) (rate(http_requests_total{env="prod",code=~"5.."}[1m])) / sum by (service) (rate(http_requests_total{env="prod"}[1m]))',
        instant: true,
        stepSeconds: 60,
      },
      context({ from: at, to: at }),
    );
    const services = frame?.values[0] ?? [];
    const ratios = frame?.values[1] ?? [];
    const checkout = ratios[services.indexOf('checkout-svc')];
    expect(checkout).toBeGreaterThan(0.07);
    expect(checkout).toBeLessThan(0.1);
  });

  test('describes the metrics with their type and labels', async () => {
    const snapshot = await connection.describe(AbortSignal.timeout(10_000));
    const requests = snapshot.entities.find((entity) => entity.name === 'http_requests_total');
    expect(requests?.description).toBe('counter');
    expect(requests?.fields.map((field) => field.name)).toEqual(
      expect.arrayContaining(['service', 'env', 'code']),
    );
    expect(requests?.fields.find((field) => field.name === 'service')?.distinctEstimate).toBe(4);
  });
});
