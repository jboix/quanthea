import { describe, expect, test } from 'bun:test';
import type { SchemaEntity } from '../_shared/index.ts';
import { ConnectorError } from '../_shared/index.ts';
import type { ApiRequest, SearchApi } from './api.ts';
import { withDistinctEstimates } from './distinct.ts';

const refuse = () => Promise.reject(new ConnectorError('internal', 'Not asked in this test.'));

/**
 * An API that answers every request with one body, or refuses it, and records the requests.
 *
 * @param body - The answer, or `undefined` to refuse.
 * @returns The API and the requests it got.
 */
function apiAnswering(body: unknown): { api: SearchApi; asked: ApiRequest[] } {
  const asked: ApiRequest[] = [];
  const api: SearchApi = {
    request: <T>(request: ApiRequest) => {
      asked.push(request);
      return body === undefined ? refuse() : Promise.resolve(body as T);
    },
    server: refuse,
    ask: refuse,
  };
  return { api, asked };
}

const signal = AbortSignal.timeout(1000);

const logs: SchemaEntity = {
  name: 'logs-*',
  kind: 'index',
  fields: [
    { name: 'session', nativeType: 'keyword', type: 'string' },
    { name: 'message', nativeType: 'text', type: 'string' },
    { name: 'level', nativeType: 'keyword', type: 'string' },
  ],
};

const metrics: SchemaEntity = {
  name: 'metrics',
  kind: 'index',
  fields: [{ name: 'value', nativeType: 'double', type: 'number' }],
};

describe('distinct-value estimates', () => {
  test('one _msearch estimates the keyword fields of the indices that have some', async () => {
    const answer = { responses: [{ aggregations: { f0: { value: 120_000 }, f1: { value: 4 } } }] };
    const { api, asked } = apiAnswering(answer);
    const [estimated, untouched] = await withDistinctEstimates(api, [logs, metrics], signal);
    expect(asked).toHaveLength(1);
    expect(asked[0]?.path).toBe('/_msearch');
    const [header, body] = (asked[0]?.lines ?? '')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(header).toEqual({ index: 'logs-*', ignore_unavailable: true });
    expect(body.terminate_after).toBe(100_000);
    expect(Object.keys(body.aggs)).toEqual(['f0', 'f1']);
    expect(estimated?.fields.map((field) => field.distinctEstimate)).toEqual([
      120_000,
      undefined,
      4,
    ]);
    expect(untouched).toEqual(metrics);
  });

  test('a refused request leaves the indices as they were', async () => {
    const { api } = apiAnswering(undefined);
    expect(await withDistinctEstimates(api, [logs], signal)).toEqual([logs]);
  });

  test('indices with no keyword field send nothing', async () => {
    const { api, asked } = apiAnswering({});
    expect(await withDistinctEstimates(api, [metrics], signal)).toEqual([metrics]);
    expect(asked).toHaveLength(0);
  });
});
