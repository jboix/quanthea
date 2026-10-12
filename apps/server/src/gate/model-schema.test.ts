import { describe, expect, test } from 'bun:test';
import type { AccessLevel, ObjectVisibility } from '@quanthea/shared';
import type { SchemaSnapshot } from '../connectors/_shared/index.ts';
import { everythingShown, scopeOf } from '../query/scope/object-scope.ts';
import { modelSchema } from './model-schema.ts';
import type { GateSubject } from './subject.ts';

const snapshot: SchemaSnapshot = {
  entities: [
    {
      name: 'customers',
      kind: 'table',
      description: 'From the source.',
      rowEstimate: 2000,
      fields: [
        { name: 'id', nativeType: 'bigint', distinctEstimate: 2000 },
        { name: 'email', nativeType: 'text', distinctEstimate: 2000 },
        { name: 'country', nativeType: 'text', description: 'ISO code.', distinctEstimate: 5 },
        { name: 'phone', nativeType: 'text' },
      ],
    },
  ],
};

/**
 * A subject at a level.
 *
 * @param accessLevel - The access level.
 * @returns The subject.
 */
function subjectAt(accessLevel: AccessLevel): GateSubject {
  return {
    id: 'c-orders',
    name: 'orders',
    kind: 'postgres',
    accessLevel,
    hiddenFields: ['customers.email', 'phone'],
    scope: everythingShown,
    descriptions: { customers: 'Shop customers.' },
  };
}

describe('modelSchema', () => {
  test('level 1: names, types and descriptions, without hidden fields or estimates', () => {
    expect(modelSchema(subjectAt(1), snapshot)).toEqual([
      {
        name: 'customers',
        kind: 'table',
        description: 'Shop customers.',
        fields: [
          { name: 'id', type: 'bigint' },
          { name: 'country', type: 'text', description: 'ISO code.' },
        ],
      },
    ]);
  });

  test('level 2: also row estimates, and distinct counts of fields with few values', () => {
    const [customers] = modelSchema(subjectAt(2), snapshot);
    expect(customers?.rows).toBe(2000);
    expect(customers?.fields).toEqual([
      { name: 'id', type: 'bigint' },
      { name: 'country', type: 'text', description: 'ISO code.', distinctValues: 5 },
    ]);
  });

  test('hides fields at every level, by entity.field or bare name', () => {
    for (const level of [1, 2, 3, 4] as const) {
      const names = modelSchema(subjectAt(level), snapshot)[0]?.fields.map((field) => field.name);
      expect(names).toEqual(['id', 'country']);
    }
  });

  test('hides nested fields under a hidden object, and names in another case', () => {
    const logs: SchemaSnapshot = {
      entities: [
        {
          name: 'app.logs',
          kind: 'index',
          fields: ['user.email', 'user.name', 'Host.IP', 'message'].map((name) => ({
            name,
            nativeType: 'keyword',
          })),
        },
      ],
    };
    const subject = { ...subjectAt(3), hiddenFields: ['APP.LOGS.user', 'app.logs.host.ip'] };
    const names = modelSchema(subject, logs)[0]?.fields.map((field) => field.name);
    expect(names).toEqual(['message']);
  });

  test('hides an object or nested field that holds a hidden field', () => {
    const logs: SchemaSnapshot = {
      entities: [
        {
          name: 'logs',
          kind: 'index',
          fields: [
            { name: 'user', nativeType: 'nested' },
            { name: 'user.email', nativeType: 'keyword' },
            { name: 'user.name', nativeType: 'keyword' },
            { name: 'username', nativeType: 'keyword' },
          ],
        },
      ],
    };
    const subject = { ...subjectAt(3), hiddenFields: ['logs.user.email'] };
    const names = modelSchema(subject, logs)[0]?.fields.map((field) => field.name);
    expect(names).toEqual(['user.name', 'username']);
  });
});

describe('modelSchema and the objects a connector shows', () => {
  const indices: SchemaSnapshot = {
    entities: ['.plugins-ml-config', 'core_events', 'logs-*', 'top_queries-2026.10.12-59492'].map(
      (name) => ({ name, kind: 'index' as const, fields: [] }),
    ),
  };

  /**
   * The index names the model gets with a visibility.
   *
   * @param visibility - What differs from the default.
   * @returns The names.
   */
  function shownWith(visibility: Partial<ObjectVisibility>): string[] {
    const scope = scopeOf(
      { showSystem: false, mode: 'except', names: [], ...visibility },
      'search',
    );
    return modelSchema({ ...subjectAt(2), scope }, indices).map((entity) => entity.name);
  }

  test("leaves out the source's own objects unless the connector shows them", () => {
    expect(shownWith({})).toEqual(['core_events', 'logs-*']);
    expect(shownWith({ showSystem: true })).toHaveLength(4);
  });

  test("leaves out the names an except list hides, and all but an only list's", () => {
    expect(shownWith({ names: ['logs-*'] })).toEqual(['core_events']);
    expect(shownWith({ mode: 'only', names: ['logs-*', '.plugins-*'] })).toEqual(['logs-*']);
  });
});
