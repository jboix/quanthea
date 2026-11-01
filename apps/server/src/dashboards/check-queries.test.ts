import { describe, expect, test } from 'bun:test';
import { type ConnectorFacts, checkBinding } from './check-queries.ts';

const guardrails = { timeoutMs: 10_000, maxRows: 50_000, maxRangeDays: 90 };
const timeRange = { from: 0, to: 3_600_000 };

/** A search with a `bucket_script` of its own, where a panel holds it. */
const located = {
  path: 'panels[0].queries[0]',
  query: {
    refId: 'A',
    connector: 'logs',
    language: 'search',
    index: 'logs-*',
    body: {
      size: 0,
      aggs: {
        service: {
          terms: { field: 'service' },
          aggs: {
            _errors: { filter: { term: { level: 'error' } } },
            more: {
              bucket_script: {
                buckets_path: { errors: '_errors>_count', all: '_count' },
                script: 'params.all - params.errors',
              },
            },
          },
        },
      },
    },
  },
} as const;

describe('a bucket script in a stored query', () => {
  test('is an issue on a connector that does not allow one, at the body', () => {
    const connector: ConnectorFacts = { language: 'search', guardrails };
    for (const facts of [connector, { ...connector, bucketScripts: false }]) {
      const [issue, ...rest] = checkBinding(located, facts, {}, timeRange);
      expect(rest).toEqual([]);
      expect(issue?.path).toBe('panels[0].queries[0].body');
      expect(issue?.message).toContain('only the two ratio scripts');
    }
  });

  test('is none on a connector that allows one', () => {
    const connector: ConnectorFacts = { language: 'search', guardrails, bucketScripts: true };
    expect(checkBinding(located, connector, {}, timeRange)).toEqual([]);
  });
});

describe('the buckets of a stored search', () => {
  /**
   * A search of a count per time bucket and per value of a field.
   *
   * @param interval - The bucket width.
   * @param size - The values of the field.
   * @returns The query and its path.
   */
  function series(interval: string, size: number) {
    const aggs = {
      time: {
        date_histogram: { field: '@timestamp', fixed_interval: interval },
        aggs: { service: { terms: { field: 'service', size } } },
      },
    };
    const query = { ...located.query, body: { size: 0, aggs } };
    return { path: 'panels[0].queries[0]', query };
  }
  const connector: ConnectorFacts = { language: 'search', guardrails };
  const day = { from: 0, to: 86_400_000 };

  test('are an issue past what a search server allows, with an interval that fits', () => {
    const [issue] = checkBinding(series('10s', 50), connector, {}, day);
    expect(issue?.path).toBe('panels[0].queries[0].body');
    expect(issue?.message).toBe(
      "This search makes about 432,000 buckets over the dashboard's range, and a search server stops at 65,536: use an interval of 5m or more, or fewer groups.",
    );
  });

  test('are no issue within the limit', () => {
    expect(checkBinding(series('1m', 40), connector, {}, day)).toEqual([]);
  });
});
