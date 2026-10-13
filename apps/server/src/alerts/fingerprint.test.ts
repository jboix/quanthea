import { describe, expect, test } from 'bun:test';
import type { QueryTemplate } from '@quanthea/shared';
import { buildData } from '../dashboards/queries/build.ts';
import { dataSchema } from '../dashboards/queries/request.ts';
import { queryFingerprint } from './fingerprint.ts';

/**
 * A SQL query on the connector `shop`.
 *
 * @param sql - The SQL.
 * @returns The query.
 */
const sql = (sql: string): QueryTemplate => ({ connector: 'shop', language: 'sql', sql });

/**
 * A PromQL query on the connector `prom`.
 *
 * @param expr - The expression.
 * @returns The query.
 */
const promql = (expr: string): QueryTemplate => ({ connector: 'prom', language: 'promql', expr });

describe('queryFingerprint', () => {
  test('ignores SQL spacing, comments, the case of keywords and a final semicolon', () => {
    const written = `-- failed orders
      SELECT count(*) AS value
      FROM orders /* only failed */ WHERE status = 'failed' ;`;
    expect(queryFingerprint(sql(written))).toBe(
      queryFingerprint(sql("select count( * ) as value from orders where status='failed'")),
    );
  });

  test('keeps what quotes hold, and tells other SQL apart', () => {
    const base = queryFingerprint(sql("SELECT 1 FROM t WHERE note = 'a  b -- c'"));
    expect(queryFingerprint(sql("SELECT 1 FROM t WHERE note = 'a b -- c'"))).not.toBe(base);
    expect(queryFingerprint(sql("SELECT 1 FROM t WHERE note = 'A  b -- c'"))).not.toBe(base);
    expect(queryFingerprint(sql('SELECT 2 FROM t'))).not.toBe(
      queryFingerprint(sql('SELECT 1 FROM t')),
    );
  });

  test('ignores PromQL spacing and comments, and keeps the case of names', () => {
    const tidy = 'sum by (service) (rate(http_requests_total{code=~"5.."}[5m]))';
    const loose = `sum   by(service)(
      rate( http_requests_total{ code =~ "5.." } [5m] ) # the 5xx
    )`;
    expect(queryFingerprint(promql(loose))).toBe(queryFingerprint(promql(tidy)));
    expect(queryFingerprint(promql(tidy.replace('http', 'HTTP')))).not.toBe(
      queryFingerprint(promql(tidy)),
    );
  });

  test('tells connectors and languages apart, and leaves the step and refId out', () => {
    const query = promql('up');
    expect(queryFingerprint({ ...query, connector: 'other' })).not.toBe(queryFingerprint(query));
    expect(queryFingerprint({ connector: 'prom', language: 'logql', expr: 'up' })).not.toBe(
      queryFingerprint(query),
    );
    const stepped: QueryTemplate = {
      connector: 'prom',
      language: 'promql',
      expr: 'up',
      step: '1m',
    };
    expect(queryFingerprint({ ...stepped, instant: true })).toBe(queryFingerprint(query));
  });

  test('reads JSON queries with their keys in any order', () => {
    const a: QueryTemplate = {
      connector: 'logs',
      language: 'search',
      index: 'web-*',
      body: { size: 0, query: { term: { code: 500 } } },
    };
    const b: QueryTemplate = { ...a, body: { query: { term: { code: 500 } }, size: 0 } };
    expect(queryFingerprint(a)).toBe(queryFingerprint(b));
    expect(queryFingerprint({ ...a, index: 'api-*' })).not.toBe(queryFingerprint(a));
  });

  test('leaves out whether a search date histogram keeps its empty buckets', () => {
    /**
     * A count over time, with more settings on its histogram.
     *
     * @param more - The settings.
     * @returns The query.
     */
    const overTime = (more: Record<string, unknown>): QueryTemplate => ({
      connector: 'logs',
      language: 'search',
      index: 'web-*',
      body: {
        size: 0,
        aggs: { time: { date_histogram: { field: '@timestamp', fixed_interval: '1h', ...more } } },
      },
    });
    const base = queryFingerprint(overTime({}));
    expect(queryFingerprint(overTime({ min_doc_count: 1 }))).toBe(base);
    expect(queryFingerprint(overTime({ min_doc_count: 0 }))).toBe(base);
    expect(queryFingerprint(overTime({ fixed_interval: '1d' }))).not.toBe(base);
    const terms = (floor: number): QueryTemplate => ({
      connector: 'logs',
      language: 'search',
      index: 'web-*',
      body: { aggs: { level: { terms: { field: 'level', min_doc_count: floor } } } },
    });
    expect(queryFingerprint(terms(1))).not.toBe(queryFingerprint(terms(5)));
  });

  test('matches a builder rendered once with the same query written by hand', () => {
    const built = buildData(
      dataSchema.parse({
        kind: 'rate',
        connector: 'prom',
        metric: 'http_requests_total',
        by: ['service'],
      }),
    ).queries[0];
    if (built?.language !== 'promql') throw new Error('expected a PromQL query');
    const spaced = built.expr.replaceAll('(', ' ( ').replaceAll(',', ' , ');
    expect(queryFingerprint(promql(spaced))).toBe(queryFingerprint(built));
  });
});
