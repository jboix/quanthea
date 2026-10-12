import { describe, expect, test } from 'bun:test';
import type { ObjectVisibility } from '@quanthea/shared';
import type { BoundQuery, QueryLanguage } from '../../connectors/_shared/index.ts';
import { QueryError } from '../query-error.ts';
import { checkScope } from './check.ts';
import { everythingShown, isSystemObject, scopeOf, showsObject } from './object-scope.ts';

/**
 * Why a query is refused, if it is.
 *
 * @param query - The bound query.
 * @param visibility - The connector's visibility; the default when not given.
 * @returns The message, or `undefined` when the query passes.
 */
function refusal(
  query: BoundQuery,
  visibility: Partial<ObjectVisibility> = {},
): string | undefined {
  const scope = scopeOf(
    { showSystem: false, mode: 'except', names: [], ...visibility },
    query.language,
  );
  try {
    checkScope(scope, query);
    return undefined;
  } catch (error) {
    if (error instanceof QueryError) return error.safeMessage;
    throw error;
  }
}

/**
 * A scope with the default visibility and a list.
 *
 * @param language - The query language.
 * @param visibility - What differs from the default.
 * @returns The scope.
 */
function scopeFor(language: QueryLanguage, visibility: Partial<ObjectVisibility> = {}) {
  return scopeOf({ showSystem: false, mode: 'except', names: [], ...visibility }, language);
}

describe('showsObject', () => {
  test('hides the indices a search server keeps for itself', () => {
    const scope = scopeFor('search');
    const shown = ['logs-*', 'core_events', 'security'].filter((name) => showsObject(scope, name));
    expect(shown).toEqual(['logs-*', 'core_events', 'security']);
    for (const name of [
      '.kibana_1',
      '.plugins-ml-config',
      '.opendistro_security',
      'security-auditlog-*',
      'security-auditlog-2026.10.12',
      'top_queries-2026.10.12-59492',
      'ilm-history-7',
    ])
      expect(showsObject(scope, name)).toBe(false);
    expect(showsObject(scopeFor('search', { showSystem: true }), '.kibana_1')).toBe(true);
  });

  test('hides the system collections of MongoDB and nothing of a source without any', () => {
    expect(showsObject(scopeFor('mongodb'), 'system.views')).toBe(false);
    expect(showsObject(scopeFor('mongodb'), 'orders')).toBe(true);
    expect(isSystemObject('plain', '.hidden')).toBe(false);
    expect(showsObject(scopeFor('promql'), 'up')).toBe(true);
  });

  test('applies the list after the system rule', () => {
    const only = scopeFor('search', { mode: 'only', names: ['logs-*', '.kibana*'] });
    expect(showsObject(only, 'logs-*')).toBe(true);
    expect(showsObject(only, 'logs-2026.10.12')).toBe(true);
    expect(showsObject(only, 'core_events')).toBe(false);
    expect(showsObject(only, '.kibana_1')).toBe(false);
    expect(showsObject(everythingShown, '.kibana_1')).toBe(true);
  });
});

describe('one rule for a SQL name', () => {
  /**
   * Whether a query on a table passes, to compare with what the catalogue lists.
   *
   * @param scope - The connector's scope.
   * @param table - The table, as the catalogue names it.
   * @returns `true` when the query is not refused.
   */
  function queryPasses(scope: ReturnType<typeof scopeOf>, table: string): boolean {
    try {
      checkScope(scope, { language: 'sql', text: `SELECT * FROM ${table}`, parameters: [] });
      return true;
    } catch {
      return false;
    }
  }

  test('a hidden name hides the table in every schema, in the catalogue as in a query', () => {
    const scope = scopeOf(
      { showSystem: false, mode: 'except', names: ['salaries'] },
      'sql',
      'postgres',
    );
    expect(showsObject(scope, 'hr.salaries')).toBe(false);
    expect(showsObject(scope, 'salaries')).toBe(false);
    expect(showsObject(scope, 'hr.salaries_archive')).toBe(true);
    expect(showsObject(scope, 'hr.people')).toBe(true);
  });

  test('the catalogue lists a table exactly when a query on it passes', () => {
    const lists: ObjectVisibility[] = [
      { showSystem: false, mode: 'except', names: ['salaries', 'shop.*', 'Audit'] },
      { showSystem: false, mode: 'only', names: ['orders', 'hr.salaries', 'public.events'] },
      { showSystem: true, mode: 'except', names: ['hr.*'] },
    ];
    const tables = [
      ...['orders', 'public.orders', 'shop.orders', 'salaries', 'hr.salaries', 'hr.people'],
      ...['audit', 'public.audit', 'events', 'public.events', 'pg_catalog.pg_class'],
    ];
    for (const visibility of lists) {
      for (const flavor of ['postgres', 'mysql', 'clickhouse'] as const) {
        const scope = scopeOf(visibility, 'sql', flavor);
        for (const table of tables)
          expect([flavor, table, showsObject(scope, table)]).toEqual([
            flavor,
            table,
            queryPasses(scope, table),
          ]);
      }
    }
  });

  test('an only list shows a table of the default schema written either way', () => {
    const scope = scopeOf(
      { showSystem: false, mode: 'only', names: ['orders'] },
      'sql',
      'postgres',
    );
    expect(showsObject(scope, 'orders')).toBe(true);
    expect(showsObject(scope, 'public.orders')).toBe(true);
    expect(showsObject(scope, 'shop.orders')).toBe(false);
    const mysql = scopeOf({ showSystem: false, mode: 'only', names: ['orders'] }, 'sql', 'mysql');
    expect(showsObject(mysql, 'public.orders')).toBe(false);
  });
});

describe('the case of a name', () => {
  const orders = { language: 'mongodb', collection: 'Orders', pipeline: [] } as const;
  const key = { language: 'redis', command: 'GET', args: ['ORDERS'] } as const;
  const metric = { language: 'promql', expr: 'Orders', instant: true, stepSeconds: 15 } as const;
  const users = {
    language: 'http',
    method: 'GET',
    path: '/Users',
    query: [],
    extract: { rows: '' },
  } as const;

  test('counts where the source tells names apart by it: an only list lets no other case in', () => {
    const only = (names: string[]) => ({ mode: 'only', names }) as const;
    expect(refusal(orders, only(['orders']))).toContain('"Orders"');
    expect(refusal(orders, only(['Orders']))).toBeUndefined();
    expect(refusal(key, only(['orders']))).toContain('"ORDERS"');
    expect(refusal(metric, only(['orders']))).toContain('"Orders"');
    expect(refusal(users, only(['GET /users']))).toContain('GET /Users');
    expect(refusal(users, only(['GET /Users']))).toBeUndefined();
  });

  test('counts for an except list too: it hides the name as written, and no other', () => {
    expect(refusal(orders, { names: ['orders'] })).toBeUndefined();
    expect(refusal(orders, { names: ['Orders'] })).toContain('"Orders"');
    expect(refusal(key, { names: ['orders', 'ORD*'] })).toContain('"ORDERS"');
    expect(refusal(metric, { names: ['orders'] })).toBeUndefined();
    expect(showsObject(scopeFor('mongodb', { names: ['orders'] }), 'Orders')).toBe(true);
  });

  test('is folded for SQL, search and Loki', () => {
    const sql = { language: 'sql', text: 'SELECT * FROM Orders', parameters: [] } as const;
    expect(refusal(sql, { names: ['ORDERS'] })).toContain('does not show');
    expect(refusal(sql, { mode: 'only', names: ['ORDERS'] })).toBeUndefined();
    const search = { language: 'search', index: 'Payroll', body: {} } as const;
    expect(refusal(search, { names: ['payroll'] })).toContain('"Payroll"');
    const logs = { language: 'logql', expr: '{app="x"}', instant: false, stepSeconds: 15 } as const;
    expect(refusal(logs, { names: ['LOGS'] })).toContain('"logs"');
  });
});

describe('checkScope', () => {
  test('checks every collection a MongoDB pipeline reads', () => {
    const pipeline = [
      { $lookup: { from: 'customers', pipeline: [{ $unionWith: 'refunds' }] } },
      {
        $facet: { a: [{ $graphLookup: { from: 'salaries' } }, { $unionWith: { coll: 'audit' } }] },
      },
    ];
    const query = { language: 'mongodb', collection: 'orders', pipeline } as const;
    expect(refusal(query)).toBeUndefined();
    expect(refusal(query, { names: ['salaries'] })).toContain('"salaries"');
    expect(refusal(query, { names: ['aud*'] })).toContain('"audit"');
    expect(refusal(query, { names: ['refunds'] })).toContain('"refunds"');
    expect(refusal(query, { mode: 'only', names: ['orders', 'customers'] })).toContain('"refunds"');
    const system = { language: 'mongodb', collection: 'system.profile', pipeline: [] } as const;
    expect(refusal(system)).toContain('system.profile');
    expect(refusal(system, { showSystem: true })).toBeUndefined();
  });

  test('checks the metrics of a PromQL expression', () => {
    const query = {
      language: 'promql',
      expr: 'rate(payroll_total[5m]) / up',
      instant: true,
      stepSeconds: 15,
    } as const;
    expect(refusal(query)).toBeUndefined();
    expect(refusal(query, { names: ['payroll_*'] })).toContain('"payroll_total"');
    expect(refusal(query, { mode: 'only', names: ['up'] })).toContain('"payroll_total"');
    const open = { ...query, expr: '{job="api"}' };
    expect(refusal(open)).toBeUndefined();
    expect(refusal(open, { names: ['payroll_*'] })).toContain('Name the metric');
  });

  test('checks the keys of a Redis command', () => {
    const get = { language: 'redis', command: 'HGETALL', args: ['session:42'] } as const;
    expect(refusal(get, { names: ['session:*'] })).toContain('"session:42"');
    expect(refusal(get, { mode: 'only', names: ['session:*'] })).toBeUndefined();
    const many = { language: 'redis', command: 'MGET', args: ['stats:a', 'session:1'] } as const;
    expect(refusal(many, { names: ['session:*'] })).toContain('"session:1"');
    const range = {
      language: 'redis',
      command: 'ZRANGE',
      args: ['board', 'session:1', '9'],
    } as const;
    expect(refusal(range, { names: ['session:*'] })).toBeUndefined();
    const info = { language: 'redis', command: 'INFO', args: ['memory'] } as const;
    expect(refusal(info, { mode: 'only', names: ['session:*'] })).toBeUndefined();
  });

  test('checks the endpoint of an HTTP request', () => {
    const query = {
      language: 'http',
      method: 'GET',
      path: '/users/42/invoices',
      query: [],
      extract: { rows: '' },
    } as const;
    expect(refusal(query)).toBeUndefined();
    expect(refusal(query, { names: ['GET /users/{id}/invoices'] })).toContain(
      'GET /users/42/invoices',
    );
    expect(refusal(query, { names: ['POST /users/{id}/invoices'] })).toBeUndefined();
    expect(refusal(query, { mode: 'only', names: ['GET /users/{id}/invoices'] })).toBeUndefined();
    expect(refusal(query, { mode: 'only', names: ['GET /orders'] })).toContain('does not show');
  });

  test('checks the one object of Loki and the indices a search names in full', () => {
    const logs = { language: 'logql', expr: '{app="x"}', instant: false, stepSeconds: 15 } as const;
    expect(refusal(logs)).toBeUndefined();
    expect(refusal(logs, { names: ['logs'] })).toContain('"logs"');
    const search = { language: 'search', index: 'logs-*,payroll', body: {} } as const;
    expect(refusal(search)).toBeUndefined();
    expect(refusal(search, { names: ['payroll'] })).toContain('"payroll"');
    expect(refusal({ ...search, index: '.kibana_1' })).toContain('.kibana_1');
    expect(refusal({ ...search, index: 'security-auditlog-2026.10.12' })).toBeDefined();
  });
});
