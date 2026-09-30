import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  ConnectorError,
  type ConnectorInstance,
  type ExecutionContext,
  type SearchQuery,
} from '../_shared/index.ts';
import { testConnectorConformance } from '../_shared/test/conformance.ts';
import { devIncidentStart, devSearchServers, integrationFor } from '../_shared/test/dev-sources.ts';
import { elasticsearchConnector } from './elasticsearch-connector.ts';

const live = integrationFor('search');
const incident = devIncidentStart();
const timeRange = {
  from: new Date(incident.getTime() - 30 * 60_000),
  to: new Date(incident.getTime() + 60 * 60_000),
};

/** The incident hour, as a filter. */
const inRange = {
  range: {
    '@timestamp': { gte: timeRange.from.toISOString(), lte: timeRange.to.toISOString() },
  },
};

/**
 * A bound search over the logs.
 *
 * @param body - The body.
 * @param index - The index.
 * @returns The query.
 */
function search(body: Record<string, unknown>, index = 'logs-*'): SearchQuery {
  return { language: 'search', index, body };
}

/**
 * An execution context over the incident.
 *
 * @param overrides - Fields to replace.
 * @returns The context.
 */
function context(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    refId: 'A',
    signal: AbortSignal.timeout(20_000),
    timeoutMs: 20_000,
    maxRows: 5000,
    timeRange,
    ...overrides,
  };
}

for (const server of devSearchServers) {
  testConnectorConformance(elasticsearchConnector, {
    config: server.config,
    secret: server.secret,
    query: search({
      query: { bool: { filter: [inRange] } },
      aggs: { time: { date_histogram: { field: '@timestamp', fixed_interval: '5m' } } },
    }),
    invalidQuery: search({ query: { nope: {} } }),
    sampleField: { entity: 'logs-*', field: 'level' },
    timeRange,
    live,
    label: server.name,
  });

  describe.skipIf(!live)(`search connector against the dev ${server.name}`, () => {
    let connection: ConnectorInstance;

    beforeAll(() => {
      connection = elasticsearchConnector.open({
        config: elasticsearchConnector.configSchema.parse(server.config),
        secret: elasticsearchConnector.secretSchema.parse(server.secret),
      });
    });

    afterAll(() => connection.close());

    /**
     * Runs a search and returns its frame.
     *
     * @param query - The search.
     * @param overrides - Context fields to replace.
     * @returns The frame.
     */
    async function frameOf(query: SearchQuery, overrides: Partial<ExecutionContext> = {}) {
      const [frame] = await connection.execute(query, context(overrides));
      if (!frame) throw new Error('No frame.');
      return frame;
    }

    test('names the server', async () => {
      const health = await connection.test(AbortSignal.timeout(20_000));
      expect(health).toMatchObject({ ok: true, readOnly: null });
      expect(health.message).toStartWith(`${server.name} `);
    });

    test('turns nested aggregations into one long table, with the incident in it', async () => {
      const frame = await frameOf(
        search({
          query: { bool: { filter: [inRange, { term: { service: 'checkout-svc' } }] } },
          aggs: {
            time: {
              date_histogram: { field: '@timestamp', fixed_interval: '5m' },
              aggs: { level: { terms: { field: 'level' } } },
            },
          },
        }),
      );
      expect(frame.fields.map((field) => [field.name, field.type])).toEqual([
        ['time', 'time'],
        ['level', 'string'],
        ['count', 'number'],
      ]);
      const [times, levels, counts] = frame.values as [number[], string[], number[]];
      const errors = times.flatMap((time, row) =>
        levels[row] === 'error' ? [[time, counts[row] ?? 0]] : [],
      );
      const [peak] = [...errors].sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
      const minutes = ((peak?.[0] ?? 0) - incident.getTime()) / 60_000;
      expect(minutes).toBeGreaterThanOrEqual(5);
      expect(minutes).toBeLessThanOrEqual(25);
    });

    test('gives a column per metric and per percentile', async () => {
      const frame = await frameOf(
        search({
          query: { bool: { filter: [inRange] } },
          aggs: {
            service: {
              terms: { field: 'service', size: 10 },
              aggs: {
                slow: { percentiles: { field: 'duration_ms', percents: [50, 95] } },
                mean: { avg: { field: 'duration_ms' } },
              },
            },
          },
        }),
      );
      expect(frame.fields.map((field) => field.name)).toEqual([
        'service',
        'slow p50',
        'slow p95',
        'mean',
      ]);
      expect(frame.meta.rowCount).toBe(4);
    });

    test('lists documents as typed columns, capped at the row limit', async () => {
      const frame = await frameOf(
        search({
          size: 500,
          query: { bool: { filter: [inRange, { term: { level: 'error' } }] } },
          sort: [{ '@timestamp': 'asc' }],
        }),
        { maxRows: 10 },
      );
      expect(frame.meta).toMatchObject({ rowCount: 10, truncated: true });
      const types = Object.fromEntries(frame.fields.map((field) => [field.name, field.type]));
      expect(types).toMatchObject({ '@timestamp': 'time', status: 'number', level: 'string' });
      const levels = frame.values[frame.fields.findIndex((field) => field.name === 'level')];
      expect(new Set(levels)).toEqual(new Set(['error']));
    });

    test('names a missing index, and nothing of a value in an error', async () => {
      const missing = await connection
        .execute(search({ query: { match_all: {} } }, 'nope'), context())
        .catch((error: unknown) => error as ConnectorError);
      expect(missing).toMatchObject({
        code: 'not_found',
        safeMessage: 'Index "nope" does not exist.',
      });
      const wrong = await connection
        .execute(search({ query: { term: { status: 'secret-value' } } }), context())
        .catch((error: unknown) => error as ConnectorError);
      expect(wrong).toBeInstanceOf(ConnectorError);
      expect((wrong as ConnectorError).safeMessage).not.toContain('secret-value');
    });

    test('describes daily indices as one pattern with their fields and documents', async () => {
      const snapshot = await connection.describe(AbortSignal.timeout(20_000));
      const logs = snapshot.entities.find((entity) => entity.name === 'logs-*');
      expect(logs?.kind).toBe('index');
      expect(logs?.rowEstimate).toBeGreaterThan(100_000);
      const fields = Object.fromEntries(
        (logs?.fields ?? []).map((field) => [field.name, field.type]),
      );
      expect(fields).toMatchObject({
        '@timestamp': 'time',
        duration_ms: 'number',
        message: 'string',
        'message.keyword': 'string',
      });
    });

    test('samples keyword fields, text fields through their keyword, and nothing unknown', async () => {
      const levels = await connection.sampleValues(
        { entity: 'logs-*', field: 'level' },
        10,
        AbortSignal.timeout(20_000),
      );
      expect([...levels.values].sort()).toEqual(['error', 'info', 'warn']);
      const messages = await connection.sampleValues(
        { entity: 'logs-*', field: 'message' },
        3,
        AbortSignal.timeout(20_000),
      );
      expect(messages).toMatchObject({ complete: false });
      for (const field of [
        { entity: 'logs-*', field: 'nope' },
        { entity: '.security', field: 'level' },
      ]) {
        const failure = await connection
          .sampleValues(field, 10, AbortSignal.timeout(20_000))
          .catch((error: unknown) => error as ConnectorError);
        expect(failure).toMatchObject({ code: 'not_found' });
      }
    });
  });
}
