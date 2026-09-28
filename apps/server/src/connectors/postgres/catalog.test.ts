import { describe, expect, test } from 'bun:test';
import { type CatalogRow, entityName, quoteIdentifier, toEntities } from './catalog.ts';
import { fieldTypeOf } from './columns.ts';

/**
 * A catalog row with defaults.
 *
 * @param overrides - The fields that differ.
 * @returns The row.
 */
function row(overrides: Partial<CatalogRow>): CatalogRow {
  return {
    schema: 'public',
    table: 'orders',
    relkind: 'r',
    table_comment: null,
    row_estimate: 1000,
    column: 'id',
    data_type: 'bigint',
    type_oid: 20,
    column_comment: null,
    n_distinct: null,
    ...overrides,
  };
}

describe('toEntities', () => {
  test('groups columns by table, with comments and estimates', () => {
    const entities = toEntities(
      [
        row({ table_comment: 'One row per order attempt.' }),
        row({ column: 'status', data_type: 'text', type_oid: 25, n_distinct: 3 }),
        row({ column: 'customer_id', n_distinct: -0.5 }),
        row({
          schema: 'analytics',
          table: 'daily',
          relkind: 'v',
          row_estimate: -1,
          column: 'day',
          data_type: 'date',
          type_oid: 1082,
        }),
      ],
      fieldTypeOf,
    );
    expect(entities).toEqual([
      {
        name: 'orders',
        kind: 'table',
        description: 'One row per order attempt.',
        rowEstimate: 1000,
        fields: [
          { name: 'id', nativeType: 'bigint', type: 'number' },
          { name: 'status', nativeType: 'text', type: 'string', distinctEstimate: 3 },
          { name: 'customer_id', nativeType: 'bigint', type: 'number', distinctEstimate: 500 },
        ],
      },
      {
        name: 'analytics.daily',
        kind: 'view',
        fields: [{ name: 'day', nativeType: 'date', type: 'time' }],
      },
    ]);
  });
});

describe('identifiers', () => {
  test('leaves public tables bare and qualifies the others', () => {
    expect(entityName('public', 'orders')).toBe('orders');
    expect(entityName('analytics', 'daily')).toBe('analytics.daily');
  });

  test('quotes identifiers and doubles inner quotes', () => {
    expect(quoteIdentifier('status')).toBe('"status"');
    expect(quoteIdentifier('a"; DROP TABLE x; --')).toBe('"a""; DROP TABLE x; --"');
  });
});
