import { describe, expect, test } from 'bun:test';
import { ConnectorError, type ConnectorInstance } from '../connectors/_shared/index.ts';
import { memoryConnector } from '../connectors/_shared/test/memory-connector.ts';
import { createQueryExecutor, type QueryRequest, type QuerySource } from './executor.ts';
import type { QueryError } from './query-error.ts';
import { createResultCache } from './result-cache.ts';
import { everythingShown, scopeOf } from './scope/object-scope.ts';

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
    scope: everythingShown,
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

describe('query executor and the objects a connector shows', () => {
  /**
   * A search source that records the index each query ran on.
   *
   * @param names - The names an except list hides.
   * @returns The source and the indices searched.
   */
  function searchSource(names: string[] = []) {
    const searched: string[] = [];
    const calls = { resolve: 0 };
    const { source } = memorySource({
      execute: (query, context) => {
        if (query.language === 'search') searched.push(query.index);
        const meta = { rowCount: 0, truncated: false, durationMs: 0 };
        return Promise.resolve([{ refId: context.refId, fields: [], values: [], meta }]);
      },
      resolveObjects: () => {
        calls.resolve += 1;
        return Promise.resolve([{ name: 'logs-1' }, { name: 'logs-payroll' }, { name: '.tasks' }]);
      },
    });
    const scope = scopeOf({ showSystem: false, mode: 'except', names }, 'search');
    return { source: { ...source, language: 'search' as const, scope }, searched, calls };
  }

  const search: QueryRequest = {
    ...request,
    template: { language: 'search', index: '*', body: {} },
  };

  test('refuses a query on a hidden table before calling the connector', async () => {
    const { source, calls } = memorySource();
    const scope = scopeOf(
      { showSystem: false, mode: 'except', names: ['events'] },
      'sql',
      'postgres',
    );
    const failure = await failureOf({ ...source, scope });
    expect(failure.code).toBe('invalid');
    expect(failure.safeMessage).toContain('does not show "events"');
    expect(calls.execute).toBe(0);
  });

  test('resolves a search pattern first and runs it without the hidden indices', async () => {
    const { source, searched, calls } = searchSource(['logs-payroll']);
    const executor = createQueryExecutor(createResultCache({ ttlMs: 15_000, maxEntries: 10 }));
    const result = await executor.run(source, search);
    expect(searched).toEqual(['*,-logs-payroll,-.tasks']);
    expect(result.bound).toMatchObject({ index: '*,-logs-payroll,-.tasks' });
    expect((await executor.run(source, search)).cached).toBe(true);
    expect(calls.resolve).toBe(1);
  });

  test('refuses a search that names a hidden index, and a dot index unless shown', async () => {
    const { source, searched } = searchSource(['logs-payroll']);
    const named = { ...search, template: { ...search.template, index: 'logs-payroll' } };
    expect((await failureOf(source, named)).safeMessage).toContain('does not show "logs-payroll"');
    const dotted = { ...search, template: { ...search.template, index: '.tasks' } };
    expect((await failureOf(source, dotted)).code).toBe('invalid');
    const open = scopeOf({ showSystem: true, mode: 'except', names: [] }, 'search');
    const executor = createQueryExecutor(createResultCache({ ttlMs: 15_000, maxEntries: 10 }));
    await executor.run({ ...source, scope: open }, dotted);
    expect(searched).toEqual(['.tasks']);
  });

  test('runs a bucket script of the query only on a connector that allows one', async () => {
    const { source, searched } = searchSource();
    const selector = { buckets_path: { count: '_count' }, script: 'params.count > 100' };
    const aggs = {
      busy: { terms: { field: 'service' }, aggs: { keep: { bucket_selector: selector } } },
    };
    const scripted = { ...search, template: { ...search.template, body: { size: 0, aggs } } };
    for (const refusing of [source, { ...source, bucketScripts: false }]) {
      const failure = await failureOf(refusing, scripted);
      expect(failure.code).toBe('invalid');
      expect(failure.safeMessage).toContain('An admin can allow scripts in bucket_script');
    }
    expect(searched).toEqual([]);
    const executor = createQueryExecutor(createResultCache({ ttlMs: 15_000, maxEntries: 10 }));
    const { bound } = await executor.run({ ...source, bucketScripts: true }, scripted);
    expect(bound).toMatchObject({ language: 'search', body: { aggs } });
    expect(searched).toHaveLength(1);
  });

  test('gives a source that cannot resolve the pattern as a connector failure', async () => {
    const { source } = searchSource();
    const failing = {
      ...source,
      instance: {
        ...source.instance,
        resolveObjects: () => Promise.reject(new ConnectorError('permission', 'Not allowed.')),
      },
    };
    const failure = await failureOf(failing, search);
    expect(failure.code).toBe('connector');
    expect(failure.safeMessage).toBe('Not allowed.');
  });
});
