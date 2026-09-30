import { describe, expect, test } from 'bun:test';
import { bindLogql } from './logql-binder.ts';

const timeRange = { from: new Date('2026-09-27T12:00:00Z'), to: new Date('2026-09-27T13:00:00Z') };

/**
 * Binds a LogQL expression over the fixed time range.
 *
 * @param expr - The expression.
 * @param variables - The variable values.
 * @returns The bound expression.
 */
function bind(expr: string, variables: Record<string, string | string[]> = {}) {
  const bindings = Object.fromEntries(
    Object.entries(variables).map(([name, value]) => [name, { value }]),
  );
  return bindLogql({ expr }, bindings, timeRange, 11_000).expr;
}

describe('bindLogql', () => {
  test('binds variables in stream matchers, line filters and label filters', () => {
    expect(
      bind('{app="$app"} |= "$text" | json | level="$level"', {
        app: 'checkout',
        text: 'timeout "x"',
        level: 'error',
      }),
    ).toBe('{app="checkout"} |= "timeout \\"x\\"" | json | level="error"');
  });

  test('escapes regular expressions after |~ and =~ unless joined from several values', () => {
    expect(bind('{app=~"$apps"} |~ "$text"', { apps: ['a.b', 'c'], text: 'a+b' })).toBe(
      '{app=~"a\\\\.b|c"} |~ "a\\\\+b"',
    );
  });

  test('puts the built-in durations and interval variables where a duration goes', () => {
    expect(bind('sum by (app) (count_over_time({app="x"}[$__interval]))', {})).toBe(
      'sum by (app) (count_over_time({app="x"}[15s]))',
    );
  });

  test('refuses a variable outside a quoted value, and in a raw or pattern string', () => {
    expect(() => bind('{app="x"} | json | $label="1"', { label: 'a' })).toThrow('quoted values');
    expect(() => bind('{app="x"} |= `$text`', { text: 'a' })).toThrow('quoted values');
    expect(() => bind('{app="x"} | pattern "$p"', { p: '<_>' })).toThrow('quoted values');
  });

  test('refuses formatting templates, which Loki runs', () => {
    expect(() => bind('{app="x"} | line_format "{{.message}}"')).toThrow('"line_format"');
    expect(() => bind('{app="x"} | label_format a="{{.b}}"')).toThrow('"label_format"');
    expect(() => bind('{app="x"} |= "line_format"')).not.toThrow();
  });
});
