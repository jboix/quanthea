import { expect, test } from 'bun:test';
import { followsTimeRange } from './follows-time-range.ts';

test('a range query in PromQL or LogQL follows the time range, an instant one does not', () => {
  const rate = { connector: 'prom', language: 'promql' as const, expr: 'rate(http_requests[5m])' };
  expect(followsTimeRange(rate)).toBe(true);
  expect(followsTimeRange({ ...rate, instant: true })).toBe(false);
  expect(followsTimeRange({ ...rate, language: 'logql' })).toBe(true);
});

test('SQL follows the time range when it names its start or its end, outside its strings', () => {
  const sql = (text: string) => ({ connector: 'pg', language: 'sql' as const, sql: text });
  expect(followsTimeRange(sql('SELECT day, n FROM t WHERE day >= :__from AND day < :__to'))).toBe(
    true,
  );
  expect(followsTimeRange(sql("SELECT day, n FROM t WHERE day >= '2026-01-01'"))).toBe(false);
  expect(followsTimeRange(sql("SELECT day, n FROM t WHERE note = ':__from' -- :__to"))).toBe(false);
});

test('a search, a pipeline and a request follow it when they name __from or __to', () => {
  const range = { range: { '@timestamp': { gte: { $var: '__from' }, lte: { $var: '__to' } } } };
  const search = { connector: 'es', language: 'search' as const, index: 'logs-*' };
  expect(followsTimeRange({ ...search, body: { query: range } })).toBe(true);
  expect(followsTimeRange({ ...search, body: { query: { match_all: {} } } })).toBe(false);
  // The connector's name is not part of what the query writes.
  expect(followsTimeRange({ ...search, connector: '__from', body: {} })).toBe(false);
});
