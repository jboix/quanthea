import { afterAll, describe, expect, test } from 'bun:test';
import {
  devHttpApi,
  devIncidentStart,
  integrationFor,
} from '../connectors/_shared/test/dev-sources.ts';
import { httpConnector } from '../connectors/http/http-connector.ts';
import { createQueryExecutor, type QuerySource } from './executor.ts';
import { createResultCache } from './result-cache.ts';
import { everythingShown } from './scope/object-scope.ts';

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
    scope: everythingShown,
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

  /**
   * Runs the errors route for a service named by a variable's value.
   *
   * @param service - The value of the path variable.
   * @returns The failure, or `undefined` when the request worked.
   */
  function errorsOf(service: string): Promise<Error | undefined> {
    const template = {
      language: 'http' as const,
      method: 'GET' as const,
      path: '/api/v1/services/$service/errors',
      extract: { rows: '/points' },
    };
    return executor
      .run(source, { refId: 'A', template, variables: { service: { value: service } }, timeRange })
      .then(
        () => undefined,
        (error: unknown) => error as Error,
      );
  }

  test('keeps a path variable in its segment, so it cannot reach another route', async () => {
    // A slash in a value is encoded, so the API sees one unknown service.
    expect((await errorsOf('checkout-svc/errors'))?.message).toContain('HTTP 404');
    // A value that climbs is refused before any request is sent.
    expect((await errorsOf('../../status'))?.message).toContain('no . or .. segment');
  });
});
