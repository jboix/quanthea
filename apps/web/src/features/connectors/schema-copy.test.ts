import { describe, expect, test } from 'bun:test';
import type { SchemaView } from '@quanthea/shared';
import { entitySummary, fieldMarker, schemaSummary } from './schema-copy.ts';

/** A field of the given shape. */
const field = (overrides: Partial<SchemaView['entities'][number]['fields'][number]>) => ({
  name: 'service',
  type: 'text',
  hidden: false,
  modelSees: 'name' as const,
  ...overrides,
});

describe('schema copy', () => {
  test('summarizes an entity by its fields, hidden fields, then rows', () => {
    const fields = [field({}), field({ hidden: true })];
    expect(entitySummary({ name: 'a', kind: 'table', fields, rows: 8_234_000 })).toBe(
      '2 columns · 1 hidden',
    );
    expect(entitySummary({ name: 'a', kind: 'table', fields: [field({})], rows: 3410 })).toBe(
      '1 column · 3,410 rows',
    );
    expect(entitySummary({ name: 'a', kind: 'table', fields: [], rows: 8_234_000 })).toBe(
      '0 columns · 8.2M rows',
    );
    expect(entitySummary({ name: 'up', kind: 'metric', fields: [field({}), field({})] })).toBe(
      '2 labels',
    );
  });

  test('counts entities by kind, or as entities when kinds mix', () => {
    const table = { name: 't', kind: 'table' as const, fields: [] };
    expect(schemaSummary({ readAt: 1, entities: [table, table] })).toBe('2 tables');
    expect(schemaSummary({ readAt: 1, entities: [table, { ...table, kind: 'view' }] })).toBe(
      '2 entities',
    );
  });

  test('marks hidden fields, shared values and high cardinality', () => {
    expect(fieldMarker(field({ hidden: true, modelSees: 'nothing' }))?.text).toBe('hidden');
    expect(fieldMarker(field({ distinctValues: 12, modelSees: 'values' }))).toEqual({
      text: '12 values shared',
      tone: 'accent',
    });
    expect(fieldMarker(field({ distinctValues: 5000 }))?.text).toBe('high cardinality');
    expect(fieldMarker(field({ distinctValues: 3 }))).toBeUndefined();
    expect(fieldMarker(field({}))).toBeUndefined();
  });
});
