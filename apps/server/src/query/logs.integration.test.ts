import { afterAll, describe, expect, test } from 'bun:test';
import {
  devElasticsearch,
  devIncidentStart,
  devLoki,
  integrationFor,
} from '../connectors/_shared/test/dev-sources.ts';
import { lokiConnector } from '../connectors/loki/loki-connector.ts';
import { elasticsearchConnector } from '../connectors/search/elasticsearch-connector.ts';
import { createQueryExecutor, type QuerySource } from './executor.ts';
import { createResultCache } from './result-cache.ts';
import type { Variables } from './variables.ts';

const incident = devIncidentStart();
const timeRange = {
  from: new Date(incident.getTime() - 30 * 60_000),
  to: new Date(incident.getTime() + 60 * 60_000),
};
const guardrails = { timeoutMs: 20_000, maxRows: 5000, maxRangeDays: 7 };
const executor = createQueryExecutor(createResultCache({ ttlMs: 1, maxEntries: 1 }));

/** The errors the incident logs, by service, as a variable picks them. */
const variables: Variables = {
  service: { value: ['checkout-svc', 'payments-svc'] },
  text: { value: 'payments-gateway' },
};

describe.skipIf(!integrationFor('search'))('search templates through the executor', () => {
  const instance = elasticsearchConnector.open({
    config: elasticsearchConnector.configSchema.parse(devElasticsearch.config),
    secret: elasticsearchConnector.secretSchema.parse(devElasticsearch.secret),
  });
  const source: QuerySource = {
    connectorId: 'es',
    version: 1,
    language: 'search',
    instance,
    guardrails,
  };
  afterAll(() => instance.close());

  test('binds variable nodes and the time range, and counts errors per service', async () => {
    const result = await executor.run(source, {
      refId: 'A',
      template: {
        language: 'search',
        index: 'logs-*',
        body: {
          query: {
            bool: {
              filter: [
                { terms: { service: { $var: 'service' } } },
                { term: { level: 'error' } },
                { match_phrase: { message: { $var: 'text' } } },
                { range: { '@timestamp': { gte: { $var: '__from' }, lte: { $var: '__to' } } } },
              ],
            },
          },
          aggs: { service: { terms: { field: 'service' } } },
        },
      },
      variables,
      timeRange,
    });
    const [frame] = result.frames;
    expect(frame?.values[0]).toContain('checkout-svc');
    expect(frame?.values[0]).not.toContain('cart-svc');
  });

  test('refuses a script before the server sees it', async () => {
    const failure = await executor
      .run(source, {
        refId: 'A',
        template: {
          language: 'search',
          index: 'logs-*',
          body: { query: { script: { script: { source: 'true' } } } },
        },
        variables: {},
        timeRange,
      })
      .then(
        () => undefined,
        (error: unknown) => error as Error,
      );
    expect(failure?.message).toContain('A query runs no script');
  });
});

describe.skipIf(!integrationFor('loki'))('LogQL templates through the executor', () => {
  const instance = lokiConnector.open({
    config: lokiConnector.configSchema.parse(devLoki.config),
    secret: lokiConnector.secretSchema.parse(devLoki.secret),
  });
  const source: QuerySource = {
    connectorId: 'loki',
    version: 1,
    language: 'logql',
    instance,
    guardrails,
  };
  afterAll(() => instance.close());

  test('binds a multi-value variable as a regular expression and a line filter as text', async () => {
    const result = await executor.run(source, {
      refId: 'A',
      template: {
        language: 'logql',
        expr: 'sum by (service) (count_over_time({service=~"$service", level="error"} |= "$text" [$__range]))',
        instant: true,
      },
      variables,
      timeRange,
    });
    const [frame] = result.frames;
    expect(result.bound).toMatchObject({
      expr: 'sum by (service) (count_over_time({service=~"checkout-svc|payments-svc", level="error"} |= "payments-gateway" [5400s]))',
    });
    expect([...(frame?.values[0] ?? [])].sort()).toEqual(['checkout-svc', 'payments-svc']);
  });
});
