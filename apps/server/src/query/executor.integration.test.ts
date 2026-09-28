import { afterAll, describe, expect, test } from 'bun:test';
import {
  devIncidentStart,
  devPostgres,
  devPrometheus,
  integrationEnabled,
} from '../connectors/_shared/test/dev-sources.ts';
import { postgresConnector } from '../connectors/postgres/postgres-connector.ts';
import { prometheusConnector } from '../connectors/prometheus/prometheus-connector.ts';
import { createQueryExecutor, type QueryRequest, type QuerySource } from './executor.ts';
import type { QueryError } from './query-error.ts';
import { createResultCache } from './result-cache.ts';

const incident = devIncidentStart();
const timeRange = {
  from: new Date(incident.getTime() - 3_600_000),
  to: new Date(incident.getTime() + 3_600_000),
};
const guardrails = { timeoutMs: 5000, maxRows: 50_000, maxRangeDays: 7 };

describe.skipIf(!integrationEnabled)('query executor against the dev sources', () => {
  const postgres = postgresConnector.open({
    config: postgresConnector.configSchema.parse(devPostgres.config),
    secret: postgresConnector.secretSchema.parse(devPostgres.secret),
  });
  const prometheus = prometheusConnector.open({
    config: prometheusConnector.configSchema.parse(devPrometheus.config),
    secret: prometheusConnector.secretSchema.parse(devPrometheus.secret),
  });
  const postgresSource: QuerySource = {
    connectorId: 'pg',
    version: 1,
    language: 'sql',
    instance: postgres,
    guardrails,
  };
  const prometheusSource: QuerySource = {
    connectorId: 'prom',
    version: 1,
    language: 'promql',
    instance: prometheus,
    guardrails,
  };

  afterAll(() => postgres.close());

  /**
   * Counts the rows of orders whose status is a value, through the executor (no cache).
   *
   * @param status - The variable value.
   * @returns The count.
   */
  const countOrders = async (status: string): Promise<unknown> => {
    const request: QueryRequest = {
      refId: 'A',
      template: {
        language: 'sql',
        sql: 'SELECT count(*) AS n FROM orders WHERE status = :status AND created_at BETWEEN :__from AND :__to',
      },
      variables: { status: { value: status } },
      timeRange,
    };
    const result = await createQueryExecutor(createResultCache({ ttlMs: 1, maxEntries: 1 })).run(
      postgresSource,
      request,
    );
    return result.frames[0]?.values[0]?.[0];
  };

  test('a SQL variable value is compared as a value, never run as SQL', async () => {
    expect(await countOrders('failed')).toBeGreaterThan(0);
    for (const attack of ["' OR '1'='1", "failed' OR 'x'='x", "x'; DROP TABLE orders; --"]) {
      expect(await countOrders(attack)).toBe(0);
    }
    expect(await countOrders('paid')).toBeGreaterThan(1000);
  });

  /**
   * Counts the series of the request rate where env matches a value.
   *
   * @param env - The variable value.
   * @returns The number of series.
   */
  const countSeries = async (env: string): Promise<number> => {
    const request: QueryRequest = {
      refId: 'A',
      template: {
        language: 'promql',
        expr: 'sum by (service) (rate(http_requests_total{env="$env"}[1m]))',
        step: '1m',
      },
      variables: { env: { value: env } },
      timeRange,
    };
    const result = await createQueryExecutor(createResultCache({ ttlMs: 1, maxEntries: 1 })).run(
      prometheusSource,
      request,
    );
    return result.frames.length;
  };

  test('a PromQL variable value stays inside its matcher', async () => {
    expect(await countSeries('prod')).toBe(4);
    expect(await countSeries('prod"} or vector(1) or http_requests_total{env="')).toBe(0);
    expect(await countSeries('prod"})) or vector(1) #')).toBe(0);
  });

  test('stops a slow SQL query at the guardrail timeout', async () => {
    const executor = createQueryExecutor(createResultCache({ ttlMs: 1, maxEntries: 1 }));
    const started = performance.now();
    const failure = await executor
      .run(
        { ...postgresSource, guardrails: { ...guardrails, timeoutMs: 1000 } },
        {
          refId: 'A',
          template: { language: 'sql', sql: 'SELECT pg_sleep(5)' },
          variables: {},
          timeRange,
        },
      )
      .catch((error: unknown) => error as QueryError);
    expect(failure).toMatchObject({ code: 'timeout' });
    expect(performance.now() - started).toBeLessThan(2500);
  });
});
