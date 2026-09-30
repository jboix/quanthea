import { describe, expect, test } from 'bun:test';
import { bindSql } from './sql-binder.ts';

const timeRange = { from: new Date('2026-09-27T12:00:00Z'), to: new Date('2026-09-27T13:00:00Z') };

/**
 * Binds a template with some variables over the fixed time range.
 *
 * @param template - The SQL template.
 * @param variables - The variable values.
 * @returns The bound query.
 */
function bind(template: string, variables: Record<string, string | string[]> = {}) {
  const bindings = Object.fromEntries(
    Object.entries(variables).map(([name, value]) => [name, { value }]),
  );
  return bindSql(template, bindings, timeRange, 'postgres');
}

describe('bindSql placeholders', () => {
  test('turns named variables and the time range into positional parameters', () => {
    expect(
      bind(
        'SELECT * FROM orders WHERE service = :service AND created_at BETWEEN :__from AND :__to',
        { service: 'checkout-svc' },
      ),
    ).toEqual({
      language: 'sql',
      text: 'SELECT * FROM orders WHERE service = $1 AND created_at BETWEEN $2 AND $3',
      parameters: ['checkout-svc', timeRange.from, timeRange.to],
    });
  });

  test('reuses the parameter of a variable used twice', () => {
    const bound = bind('SELECT :env AS a, :env AS b', { env: 'prod' });
    expect(bound.text).toBe('SELECT $1 AS a, $1 AS b');
    expect(bound.parameters).toEqual(['prod']);
  });

  test('expands a multi-value variable into a parameter list, and an empty one into NULL', () => {
    expect(
      bind('SELECT 1 WHERE service IN (:services)', { services: ['a', 'b', 'c'] }),
    ).toMatchObject({
      text: 'SELECT 1 WHERE service IN ($1, $2, $3)',
      parameters: ['a', 'b', 'c'],
    });
    expect(bind('SELECT 1 WHERE service IN (:services)', { services: [] }).text).toBe(
      'SELECT 1 WHERE service IN (NULL)',
    );
  });

  test('leaves strings, identifiers, dollar quotes, comments and casts alone', () => {
    const template = [
      "SELECT ':a' AS s, E'\\': b' AS e, \":c\" AS \"x:y\", $$ :d $$ AS d, $tag$ :e $tag$ AS e2,",
      'created_at::date, arr[1:2] -- :f',
      '/* :g /* nested :h */ :i */ FROM t WHERE x = :x',
    ].join('\n');
    const bound = bind(template, { x: '1' });
    expect(bound.parameters).toEqual(['1']);
    expect(bound.text).toBe(template.replace(':x', '$1'));
  });

  test('names every unknown variable', () => {
    expect(() => bind('SELECT :a, :b, :a')).toThrow('Unknown variables: :a, :b.');
  });

  test('refuses positional placeholders in a template', () => {
    expect(() => bind('SELECT * FROM t WHERE id = $1')).toThrow(
      'Use named variables such as :service, not $1.',
    );
  });

  test('refuses an unterminated string or comment', () => {
    expect(() => bind("SELECT 'abc")).toThrow('unterminated');
    expect(() => bind('SELECT 1 /* never closed')).toThrow('unterminated');
    expect(() => bind('SELECT $x$ body')).toThrow('unterminated');
  });
});

describe('bindSql injection', () => {
  const attacks = [
    "' OR '1'='1",
    "x'; DROP TABLE orders; --",
    '$1',
    ':other',
    "\\'; DELETE FROM orders; --",
    '$$; DELETE FROM orders; $$',
    '*/ DELETE FROM orders /*',
    "checkout'\n; UPDATE orders SET status = 'paid",
  ];

  for (const attack of attacks) {
    test(`a value never becomes SQL text: ${JSON.stringify(attack)}`, () => {
      const bound = bind('SELECT * FROM orders WHERE service = :service AND note = :other', {
        service: attack,
        other: 'fixed',
      });
      expect(bound.text).toBe('SELECT * FROM orders WHERE service = $1 AND note = $2');
      expect(bound.parameters).toEqual([attack, 'fixed']);
    });
  }
});

describe('bindSql statement check', () => {
  test('accepts SELECT, WITH, VALUES, TABLE and a parenthesised select, with a trailing semicolon', () => {
    [
      'SELECT 1;',
      'WITH x AS (SELECT 1) SELECT * FROM x',
      'VALUES (1)',
      'TABLE orders',
      '(SELECT 1) UNION (SELECT 2)',
    ].forEach((sql) => {
      expect(() => bind(sql)).not.toThrow();
    });
  });

  test('accepts keywords inside literals and quoted identifiers', () => {
    expect(() =>
      bind('SELECT \'DELETE FROM x; DROP\' AS "update", 1 AS "into" -- insert'),
    ).not.toThrow();
  });

  test('refuses a second statement', () => {
    expect(() => bind('SELECT 1; SELECT 2')).toThrow('one statement only');
  });

  test('refuses statements that are not reads', () => {
    [
      'DELETE FROM orders',
      'UPDATE orders SET status = 1',
      'SET statement_timeout = 0',
      'COPY orders TO STDOUT',
      'DO $$ BEGIN END $$',
    ].forEach((sql) => {
      expect(() => bind(sql)).toThrow('A query starts with SELECT, WITH, VALUES or TABLE.');
    });
  });

  test('refuses writes hidden inside a read', () => {
    expect(() => bind('WITH gone AS (DELETE FROM orders RETURNING id) SELECT * FROM gone')).toThrow(
      '"DELETE" is not allowed',
    );
    expect(() => bind('SELECT * INTO copy FROM orders')).toThrow('"INTO" is not allowed');
    expect(() => bind('SELECT * FROM orders FOR UPDATE')).toThrow('"UPDATE" is not allowed');
  });
});
