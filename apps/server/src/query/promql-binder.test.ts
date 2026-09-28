import { describe, expect, test } from 'bun:test';
import { bindPromql, parseDuration, stepFor } from './promql-binder.ts';
import type { Variables } from './variables.ts';

const timeRange = { from: new Date('2026-09-27T12:00:00Z'), to: new Date('2026-09-27T13:00:00Z') };

/**
 * Binds an expression over the fixed hour, with at most 11000 points.
 *
 * @param expr - The PromQL template.
 * @param variables - The variables.
 * @returns The bound expression.
 */
function bind(expr: string, variables: Variables = {}): string {
  return bindPromql({ expr }, variables, timeRange, 11_000).expr;
}

describe('bindPromql matcher values', () => {
  test(`substitutes $name and \${name} inside matcher values`, () => {
    expect(
      bind(`up{env="$env", job="\${job}-api"}`, {
        env: { value: 'prod' },
        job: { value: 'checkout' },
      }),
    ).toBe('up{env="prod", job="checkout-api"}');
  });

  test('escapes quotes and backslashes for the string', () => {
    expect(bind('up{path="$path"}', { path: { value: 'C:\\a "b"' } })).toBe(
      'up{path="C:\\\\a \\"b\\""}',
    );
    expect(bind("up{path='$path'}", { path: { value: "it's" } })).toBe("up{path='it\\'s'}");
  });

  test('escapes regular expression characters in =~ and !~, and joins several values with |', () => {
    expect(
      bind('up{service=~"$services"}', { services: { value: ['checkout.svc', 'cart(v2)'] } }),
    ).toBe('up{service=~"checkout\\\\.svc|cart\\\\(v2\\\\)"}');
    expect(bind('up{service!~"$s"}', { s: { value: 'a+' } })).toBe('up{service!~"a\\\\+"}');
  });

  test('keeps a variable declared as a regular expression unescaped for the regex', () => {
    expect(
      bind('up{service=~"$pattern"}', { pattern: { value: 'checkout-.*', regex: true } }),
    ).toBe('up{service=~"checkout-.*"}');
  });

  test('refuses several values in an exact matcher', () => {
    expect(() => bind('up{service="$s"}', { s: { value: ['a', 'b'] } })).toThrow(
      'match it with =~',
    );
  });
});

describe('bindPromql placement', () => {
  test('refuses a variable outside a matcher value', () => {
    expect(() => bind('rate($metric[5m])', { metric: { value: 'up' } })).toThrow(
      'label matcher values only',
    );
    expect(() => bind('label_replace(up, "dst", "$1", "src", "(.*)")')).toThrow(
      'label matcher values only',
    );
    expect(() => bind('up{env=`$env`}', { env: { value: 'prod' } })).toThrow(
      'label matcher values only',
    );
  });

  test('names an unknown variable', () => {
    expect(() => bind('up{env="$missing"}')).toThrow('Unknown variable $missing.');
  });

  test('substitutes the built-in durations in code', () => {
    expect(bind(`rate(up[$__rate_interval]) + rate(up[$__range]) + rate(up[\${__interval}])`)).toBe(
      'rate(up[60s]) + rate(up[3600s]) + rate(up[15s])',
    );
  });

  test('leaves comments alone', () => {
    expect(bind('up # uses $env and "quotes"', {})).toBe('up # uses $env and "quotes"');
  });
});

describe('bindPromql injection', () => {
  const attacks = [
    'prod"} or vector(1) or up{a="',
    'prod\\"} or vector(1) #',
    'prod\n} or vector(1)',
    "prod'} or vector(1) or up{a='",
    '.*',
    'prod"}[5m]) or on() vector(1',
  ];

  for (const attack of attacks) {
    test(`a value stays inside its string: ${JSON.stringify(attack)}`, () => {
      const exact = bind('up{env="$env"}', { env: { value: attack } });
      expect(exact).toBe(`up{env=${JSON.stringify(attack)}}`);
      expect(JSON.parse(exact.slice('up{env='.length, -1))).toBe(attack);
      const regex = bind('up{env=~"$env"}', { env: { value: attack } });
      expect(regex).not.toContain('vector(1)"');
      expect(regex.startsWith('up{env=~"')).toBe(true);
      expect(regex.endsWith('"}')).toBe(true);
    });
  }
});

describe('steps', () => {
  test('parses simple durations', () => {
    expect(['15s', '1m', '2h', '1d', '1w', 'abc'].map(parseDuration)).toEqual([
      15,
      60,
      7200,
      86_400,
      undefined,
      undefined,
    ]);
  });

  test('raises the step so the range fits in the point limit', () => {
    expect(stepFor({ expr: 'up', step: '15s' }, timeRange, 11_000)).toBe(15);
    expect(stepFor({ expr: 'up', step: '15s' }, timeRange, 60)).toBe(60);
    expect(() => stepFor({ expr: 'up', step: 'soon' }, timeRange, 60)).toThrow(
      'The step is a duration',
    );
  });
});
