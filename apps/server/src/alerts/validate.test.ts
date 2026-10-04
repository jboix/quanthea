import { describe, expect, test } from 'bun:test';
import type { ConnectorLookup } from '../dashboards/check-queries.ts';
import { specInput } from './test/fixtures.ts';
import { validateAlertSpec } from './validate.ts';

const guardrails = { timeoutMs: 1000, maxRows: 1000, maxRangeDays: 1 };

/** Knows a Prometheus and a Postgres connector. */
const lookup: ConnectorLookup = (name) => {
  if (name === 'prometheus') return { language: 'promql', guardrails };
  if (name === 'postgres') return { language: 'sql', dialect: 'postgres', guardrails };
  return undefined;
};

/**
 * The issues of a spec.
 *
 * @param overrides - Fields of the good spec to replace.
 * @returns The issues, empty for a valid spec.
 */
function issuesOf(overrides: Record<string, unknown> = {}) {
  const result = validateAlertSpec(specInput(overrides), { lookup, now: Date.UTC(2026, 9, 4) });
  return result.ok ? [] : result.issues;
}

describe('validating an alert spec', () => {
  test('accepts a good spec', () => {
    expect(issuesOf()).toEqual([]);
  });

  test('reports a variable the query uses without a value', () => {
    expect(issuesOf({ variables: [] })).toEqual([
      { path: 'query.expr', message: expect.stringContaining('$env') },
    ]);
  });

  test('binds list values and intervals as the query engine does', () => {
    const query = {
      refId: 'A',
      connector: 'prometheus',
      language: 'promql',
      expr: 'sum(rate(http_requests_total{env=~"$env"}[$window]))',
    };
    const variables = [
      { name: 'env', value: ['prod', 'staging'] },
      { name: 'window', value: '5m', interval: true },
    ];
    expect(issuesOf({ query, variables })).toEqual([]);
  });

  test('reports an unknown connector, and one of another language', () => {
    const query = { refId: 'A', connector: 'nowhere', language: 'promql', expr: 'up' };
    expect(issuesOf({ query })).toEqual([
      { path: 'query.connector', message: 'No connector is named "nowhere".' },
    ]);
    const sql = { refId: 'A', connector: 'prometheus', language: 'sql', sql: 'SELECT 1' };
    expect(issuesOf({ query: sql })[0]?.path).toBe('query.language');
  });

  test('reports a SQL template that is not one read statement', () => {
    const query = { refId: 'A', connector: 'postgres', language: 'sql', sql: 'DELETE FROM orders' };
    expect(issuesOf({ query, variables: [] })[0]?.path).toBe('query.sql');
  });

  test('reports a window past the connector guardrails, and an unknown time zone', () => {
    expect(issuesOf({ lookback: '2d' })[0]?.path).toBe('lookback');
    expect(issuesOf({ timezone: 'Mars/Olympus' })).toEqual([
      { path: 'timezone', message: 'Unknown time zone "Mars/Olympus".' },
    ]);
  });

  test('reports schema issues with their paths', () => {
    expect(issuesOf({ severity: 'urgent', every: '10s' }).map((issue) => issue.path)).toEqual([
      'severity',
    ]);
  });
});
