import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { buildPath, defineEndpoint, type EndpointInput } from './contract.ts';

describe('buildPath', () => {
  test('prefixes /api to a path without parameters', () => {
    expect(buildPath('/health')).toBe('/api/health');
  });

  test('fills and URL-encodes every parameter', () => {
    const path = buildPath('/dashboards/:dashboardId/versions/:version', {
      dashboardId: 'a/b c',
      version: '3',
    });
    expect(path).toBe('/api/dashboards/a%2Fb%20c/versions/3');
  });

  test('throws when a parameter is missing', () => {
    expect(() => buildPath('/threads/:threadId', {})).toThrow('Missing path parameter "threadId"');
  });
});

describe('defineEndpoint', () => {
  test('leaves undeclared input slots undefined', () => {
    const endpoint = defineEndpoint({ method: 'GET', path: '/health', output: z.object({}) });
    expect(endpoint.params).toBeUndefined();
    expect(endpoint.query).toBeUndefined();
    expect(endpoint.body).toBeUndefined();
  });

  test('requires exactly the declared input parts at the type level', () => {
    const endpoint = defineEndpoint({
      method: 'POST',
      path: '/threads/:threadId/chat',
      params: z.object({ threadId: z.string() }),
      body: z.object({ text: z.string() }),
      output: z.object({ ok: z.boolean() }),
    });
    const input: EndpointInput<typeof endpoint> = {
      params: { threadId: 't1' },
      body: { text: 'hello' },
    };
    // @ts-expect-error: `query` is not declared by this endpoint.
    const withQuery: EndpointInput<typeof endpoint> = { ...input, query: {} };
    expect(withQuery.params.threadId).toBe('t1');
  });
});
