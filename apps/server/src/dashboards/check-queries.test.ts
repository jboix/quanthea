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
