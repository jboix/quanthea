import { describe, expect, test } from 'bun:test';
import { fixedTimeOf } from './fixed-time.ts';
import type { PanelQuery } from './queries.ts';

/**
 * A SQL query.
 *
 * @param sql - Its text.
 * @returns The query.
 */
function sql(sql: string): PanelQuery {
  return { refId: 'A', connector: 'orders', language: 'sql', sql };
}

/**
 * A PromQL query.
 *
 * @param expr - Its expression.
 * @param instant - Whether it is an instant query.
 * @returns The query.
 */
function promql(expr: string, instant: boolean): PanelQuery {
  return { refId: 'A', connector: 'metrics', language: 'promql', expr, instant };
}

describe('a query that names a fixed time', () => {
  test('SQL with a literal date or the current time does', () => {
    expect(
      fixedTimeOf(sql("SELECT 1 FROM orders WHERE created_at >= '2026-10-01 13:00:00'")),
    ).toContain('fixed date');
    expect(
      fixedTimeOf(sql("SELECT 1 FROM orders WHERE created_at >= NOW() - INTERVAL '2 days'")),
    ).toContain('current time');
    expect(fixedTimeOf(sql('SELECT 1 FROM orders WHERE created_at > current_date'))).toContain(
      'current time',
    );
  });

  test('SQL on the range variables does not, nor a column merely named like a function', () => {
    expect(
      fixedTimeOf(sql('SELECT 1 FROM orders WHERE created_at BETWEEN :__from AND :__to')),
    ).toBeUndefined();
    expect(fixedTimeOf(sql('SELECT today_total FROM daily'))).toBeUndefined();
  });

  test('an instant PromQL query over a fixed window does, a range query or $__range does not', () => {
    expect(fixedTimeOf(promql('sum(increase(http_requests_total[24h]))', true))).toContain(
      '[$__range]',
    );
    expect(
      fixedTimeOf(promql('sum(increase(http_requests_total[$__range]))', true)),
    ).toBeUndefined();
    expect(fixedTimeOf(promql('sum(rate(http_requests_total[5m]))', false))).toBeUndefined();
  });
});
