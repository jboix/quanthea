import { describe, expect, test } from 'bun:test';
import type { ConnectorInstance } from '../connectors/_shared/index.ts';
import { memoryConnector } from '../connectors/_shared/test/memory-connector.ts';
import { createQueryExecutor, type QueryRequest, type QuerySource } from './executor.ts';
import type { QueryError } from './query-error.ts';
import { createResultCache } from './result-cache.ts';

const timeRange = { from: new Date('2026-09-27T12:00:00Z'), to: new Date('2026-09-27T13:00:00Z') };
const guardrails = { timeoutMs: 200, maxRows: 100, maxRangeDays: 7 };

/**
 * A memory connector source, with a call counter on execute.
 *
 * @param overrides - Instance methods to replace.
 * @returns The source and the call counter.
 */
function memorySource(overrides: Partial<ConnectorInstance> = {}) {
  const instance = memoryConnector.open({ config: { rowCount: 5 }, secret: { token: 't' } });
  const calls = { execute: 0 };
  const execute = overrides.execute ?? instance.execute;
  const source: QuerySource = {
    connectorId: 'c1',
    version: 1,
    language: 'sql',
    instance: {
      ...instance,
      ...overrides,
      execute: (query, context) => {
        calls.execute += 1;
        return execute(query, context);
      },
    },
    guardrails,
  };
  return { source, calls };
}

const request: QueryRequest = {
  refId: 'A',
  template: { language: 'sql', sql: 'SELECT * FROM events' },
  variables: {},
  timeRange,
};

/**
 * Runs a request and returns what it rejected with.
 *
 * @param source - The source.
 * @param run - The request.
 * @returns The QueryError.
 */
function failureOf(source: QuerySource, run: QueryRequest = request) {
  return createQueryExecutor(createResultCache({ ttlMs: 15_000, maxEntries: 10 }))
    .run(source, run)
    .then(
      (): QueryError => {
        throw new Error('Expected the query to fail.');
      },
      (error: unknown) => error as QueryError,
    );
}

describe('query executor', () => {
  test('binds, runs and caches: the second identical query does not reach the connector', async () => {
    const { source, calls } = memorySource();
    const executor = createQueryExecutor(createResultCache({ ttlMs: 15_000, maxEntries: 10 }));
    const first = await executor.run(source, request);
    const second = await executor.run(source, request);
    expect(first.frames[0]?.meta.rowCount).toBe(5);
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(calls.execute).toBe(1);
    await executor.run({ ...source, version: 2 }, request);
    expect(calls.execute).toBe(2);
  });

  test('refuses a template in another language', async () => {
    const { source } = memorySource();
    const failure = await failureOf(source, {
      ...request,
      template: { language: 'promql', expr: 'up' },
    });
    expect(failure.code).toBe('invalid');
  });

  test('refuses a range past the guardrail before calling the connector', async () => {
    const { source, calls } = memorySource();
    const failure = await failureOf(source, {
      ...request,
      timeRange: { from: new Date(0), to: timeRange.to },
    });
    expect(failure.code).toBe('guardrail');
    expect(calls.execute).toBe(0);
  });

  test('times out even when the connector ignores its signal', async () => {
    const { source } = memorySource({ execute: () => new Promise(() => undefined) });
    const started = performance.now();
    const failure = await failureOf(source);
    expect(failure.code).toBe('timeout');
    expect(performance.now() - started).toBeLessThan(1000);
  });

  test('stops when the caller aborts', async () => {
    const { source } = memorySource({ execute: () => new Promise(() => undefined) });
    const failure = await failureOf(source, { ...request, signal: AbortSignal.abort() });
    expect(failure.code).toBe('timeout');
  });

  test('refuses invalid frames from a connector', async () => {
    const { source } = memorySource({
      execute: () =>
        Promise.resolve([
          {
            refId: 'A',
            fields: [{ name: 'x', type: 'number' }],
            values: [['not a number']],
            meta: { rowCount: 1, truncated: false, durationMs: 0 },
          },
        ]),
    });
    const failure = await failureOf(source);
    expect(failure.code).toBe('connector');
    expect(failure.safeMessage).toStartWith('The connector returned invalid frames');
  });

  test('wraps a connector error, keeping its safe message', async () => {
    const { source } = memorySource();
    const failure = await failureOf(source, {
      ...request,
      template: { language: 'sql', sql: 'SELECT nonsense' },
    });
    expect(failure.code).toBe('connector');
    expect(failure.safeMessage).toBe('Unknown query.');
    expect(failure.connectorError?.message).toBe('Unknown query "SELECT nonsense".');
  });
});
