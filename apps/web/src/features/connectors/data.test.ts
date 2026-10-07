import { describe, expect, test } from 'bun:test';
import type { LoaderFunctionArgs } from 'react-router';
import { type ApiClient, ApiError } from '../../lib/api-client.ts';
import { countFor, loadAffectedThreads } from './data.ts';

/**
 * The arguments of the count's loader for a change to level 1.
 *
 * @returns The arguments.
 */
function countArgs(): LoaderFunctionArgs {
  const request = new Request('http://x/connectors/c1/affected-threads?accessLevel=1');
  return { request, params: { connectorId: 'c1' } } as unknown as LoaderFunctionArgs;
}

/**
 * A client whose every call fails.
 *
 * @param error - The failure.
 * @returns The client.
 */
function failingApi(error: Error): ApiClient {
  return { call: () => Promise.reject(error) } as unknown as ApiClient;
}

describe('loadAffectedThreads', () => {
  test('returns the count with the query it was asked for', async () => {
    const api = { call: async () => ({ threads: 2 }) } as unknown as ApiClient;
    expect(await loadAffectedThreads(api)(countArgs())).toEqual({
      threads: 2,
      query: '?accessLevel=1',
    });
  });

  test("returns the server's refusal instead of throwing", async () => {
    const refusal = new ApiError('forbidden', 403, 'Admins only.');
    expect(await loadAffectedThreads(failingApi(refusal))(countArgs())).toEqual({
      failure: 'Admins only.',
      query: '?accessLevel=1',
    });
  });

  test('returns a failure when the server cannot be reached', async () => {
    const result = await loadAffectedThreads(failingApi(new TypeError('fetch failed')))(
      countArgs(),
    );
    expect(result).toMatchObject({ query: '?accessLevel=1' });
    expect('failure' in result).toBe(true);
  });
});

describe('countFor', () => {
  test("reads the count or the failure of the change's own query only", () => {
    expect(countFor('?accessLevel=1', { threads: 2, query: '?accessLevel=1' })).toEqual({
      threads: 2,
    });
    expect(countFor('?accessLevel=1', { failure: 'No.', query: '?accessLevel=1' })).toEqual({
      failure: 'No.',
    });
    expect(countFor('?accessLevel=1', { threads: 2, query: '?accessLevel=2' })).toBeUndefined();
    expect(countFor('?accessLevel=1', undefined)).toBeUndefined();
    expect(countFor(undefined, { threads: 2, query: '?accessLevel=1' })).toBeUndefined();
  });
});
