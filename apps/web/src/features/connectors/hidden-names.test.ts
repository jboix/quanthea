import { describe, expect, test } from 'bun:test';
import type { SchemaView } from '@quanthea/shared';
import { hideableFields, schemaNames } from './hidden-names.ts';

/**
 * A schema of the given entities and field names.
 *
 * @param entities - The field names by entity.
 * @returns The schema.
 */
function schemaOf(entities: Readonly<Record<string, readonly string[]>>): SchemaView {
  return {
    readAt: 0,
    entities: Object.entries(entities).map(([name, fields]) => ({
      name,
      fields: fields.map((field) => ({ name: field })),
    })),
  } as unknown as SchemaView;
}

const schema = schemaOf({ customers: ['id', 'email'], logs: ['user.email', 'message'] });

describe('hideableFields', () => {
  test('lists the fields not hidden yet', () => {
    expect(hideableFields(schema, ['customers.email'])).toEqual([
      'customers.id',
      'logs.user.email',
      'logs.message',
    ]);
  });
});

describe('schemaNames', () => {
  const inSchema = schemaNames(schema);

  test('knows a field, a bare name and an object, in any case', () => {
    expect(inSchema('Customers.Email')).toBe(true);
    expect(inSchema('email')).toBe(true);
    expect(inSchema('logs.user')).toBe(true);
    expect(inSchema('user')).toBe(true);
    expect(inSchema('customers')).toBe(true);
  });

  test('marks a name the schema lacks', () => {
    expect(inSchema('customers.phone')).toBe(false);
    expect(inSchema('mail')).toBe(false);
  });

  test('marks nothing while the schema is empty', () => {
    expect(schemaNames(schemaOf({}))('anything')).toBe(true);
  });
});
