import { afterAll, describe, expect, test } from 'bun:test';
import {
  devHttpApi,
  devIncidentStart,
  integrationFor,
} from '../connectors/_shared/test/dev-sources.ts';
import { httpConnector } from '../connectors/http/http-connector.ts';
import { createQueryExecutor, type QuerySource } from './executor.ts';
import { createResultCache } from './result-cache.ts';

const incident = devIncidentStart();
const timeRange = {
  from: new Date(incident.getTime() - 30 * 60_000),
  to: new Date(incident.getTime() + 60 * 60_000),
};

describe.skipIf(!integrationFor('http'))('HTTP templates through the executor', () => {
  const instance = httpConnector.open({
    config: httpConnector.configSchema.parse(devHttpApi.config),
    secret: httpConnector.secretSchema.parse(devHttpApi.secret),
  });
  const source: QuerySource = {
    connectorId: 'api',
    version: 1,
    language: 'http',
    instance,
    guardrails: { timeoutMs: 10_000, maxRows: 5000, maxRangeDays: 7 },
  };
  const executor = createQueryExecutor(createResultCache({ ttlMs: 1, maxEntries: 1 }));
  afterAll(() => instance.close());

  test('binds a path variable, the time range and a multi-value parameter', async () => {
    const result = await executor.run(source, {
      refId: 'A',
      template: {
        language: 'http',
        method: 'GET',
        path: '/api/v1/deploys',
        query: { service: '$service', from: '$__from', to: '$__to' },
        extract: { rows: '/data', fields: [{ name: 'id', pointer: '/id' }] },
      },
      variables: { service: { value: ['checkout-svc', 'catalog-svc'] } },
      timeRange,
    });
    expect(result.frames[0]?.values[0]).toEqual([481, 482]);
    const errors = await executor.run(source, {
      refId: 'A',
      template: {
        language: 'http',
        method: 'GET',
        path: '/api/v1/services/$service/errors',
        query: { from: '$__from_s', to: '$__to_s' },
        extract: { rows: '/points' },
      },
      variables: { service: { value: 'checkout-svc' } },
      timeRange,
    });
    expect(errors.frames[0]?.meta.rowCount).toBe(91);
  });

  test('keeps a path variable in its segment, so it cannot reach another route', async () => {
    const failure = await executor
      .run(source, {
        refId: 'A',
        template: {
          language: 'http',
          method: 'GET',
          path: '/api/v1/services/$service/errors',
          extract: { rows: '/points' },
        },
        variables: { service: { value: '../../status' } },
        timeRange,
      })
      .then(
        () => undefined,
        (error: unknown) => error as Error,
      );
    expect(failure?.message).toContain('HTTP 404');
  });
});
