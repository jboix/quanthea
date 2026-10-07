import { describe, expect, test } from 'bun:test';
import { bindHttp, type HttpTemplate } from './http-binder.ts';

const timeRange = { from: new Date('2026-09-27T12:00:00Z'), to: new Date('2026-09-27T13:00:00Z') };

/**
 * Binds an HTTP template with some variables over the fixed time range.
 *
 * @param template - The template, its method and extraction defaulted.
 * @param variables - The variable values.
 * @returns The bound query.
 */
function bind(
  template: Partial<HttpTemplate> & { path: string },
  variables: Record<string, string | string[]> = {},
) {
  const bindings = Object.fromEntries(
    Object.entries(variables).map(([name, value]) => [name, { value }]),
  );
  return bindHttp({ method: 'GET', extract: { rows: '' }, ...template }, bindings, timeRange);
}

describe('bindHttp', () => {
  test('encodes path variables, passes parameters raw, and repeats a multi-value parameter', () => {
    expect(
      bind(
        {
          path: '/services/$service/errors',
          query: { from: '$__from', until: `\${__to_ms}`, env: '$env', note: 'svc-$service' },
        },
        { service: 'checkout svc', env: ['prod', 'staging'] },
      ),
    ).toEqual({
      language: 'http',
      method: 'GET',
      path: '/services/checkout%20svc/errors',
      query: [
        ['from', '2026-09-27T12:00:00.000Z'],
        ['until', '1790514000000'],
        ['env', 'prod'],
        ['env', 'staging'],
        ['note', 'svc-checkout svc'],
      ],
      extract: { rows: '' },
    });
  });

  test('keeps a path variable one segment, whatever it holds', () => {
    for (const attack of ['../admin', 'a/b', '?x=1', '#x', 'http://evil.example']) {
      const { path } = bind({ path: '/items/$id' }, { id: attack });
      expect(path).toBe(`/items/${encodeURIComponent(attack)}`);
      expect(path.split('/')).toHaveLength(3);
    }
  });

  test('binds variable nodes in a POST body', () => {
    const bound = bind(
      {
        method: 'POST',
        path: '/search',
        body: { services: { $var: 'service' }, since: { $var: '__from_s' } },
      },
      { service: ['a', 'b'] },
    );
    expect(bound.body).toEqual({ services: ['a', 'b'], since: '1790510400' });
  });

  test('refuses paths that leave their place, a body on a GET and misplaced multi-values', () => {
    for (const path of ['relative', '//evil.example/x', '/a?b=1', '/a#b', '/a/../b', '/a\\b'])
      expect(() => bind({ path })).toThrow('A path starts with /');
    expect(() => bind({ path: '/x', body: {} })).toThrow('A GET request has no body');
    expect(() => bind({ path: '/x/$s' }, { s: ['a', 'b'] })).toThrow('has several values');
    expect(() => bind({ path: '/x', query: { q: 'in:$s' } }, { s: ['a', 'b'] })).toThrow(
      'has several values',
    );
    expect(() => bind({ path: '/x/$nope' })).toThrow('Unknown variable $nope.');
  });

  test('refuses dot segments, encoded or not, in the template and in a variable value', () => {
    for (const path of [
      '/v1/./x',
      '/v1/%2e%2e/x',
      '/v1/%2E/x',
      '/v1/.%2e/x',
      '/v1/%2e./x',
      '/v1/..',
    ])
      expect(() => bind({ path })).toThrow('A path starts with /');
    for (const value of ['..', '.'])
      expect(() => bind({ path: '/v1/services/$s/errors' }, { s: value })).toThrow(
        'A path starts with /',
      );
    expect(bind({ path: '/v1/$s' }, { s: '...' }).path).toBe('/v1/...');
    expect(bind({ path: '/v1/a.b/%2e%2ex' }).path).toBe('/v1/a.b/%2e%2ex');
  });
});
