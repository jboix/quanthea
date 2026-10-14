import { describe, expect, test } from 'bun:test';
import { type DefinitionVersion, definitionSchema } from '@quanthea/shared';
import { buildData } from './build.ts';
import { expandDefinition } from './definition.ts';
import type { DataOf } from './request.ts';

/**
 * A stored version of a definition.
 *
 * @param definition - The definition, unchecked.
 * @returns The version, v3.
 */
function version(definition: unknown): DefinitionVersion {
  const parsed = definitionSchema.parse(definition);
  return { definition: parsed, version: 3, author: 'editor-1', origin: 'ui', createdAt: 1 };
}

const errorRate = version({
  id: 'error-rate',
  name: 'Error rate',
  meaning: 'ERROR events, excluding business errors, over START events.',
  bodies: [
    {
      shape: 'ratio',
      request: {
        kind: 'search-ratio',
        index: 'core_events',
        match: [
          { field: 'event_name', value: 'ERROR' },
          { field: 'data.business_error', op: '!=', value: 'true' },
        ],
        of: [{ field: 'event_name', value: 'START' }],
      },
    },
  ],
});

const prod = version({
  id: 'prod',
  name: 'Prod',
  meaning: 'The production environment.',
  bodies: [
    {
      shape: 'segment',
      request: {
        kind: 'search-stat',
        index: 'core_events',
        filters: [{ field: 'env', value: 'prod' }],
      },
    },
  ],
});

/**
 * A request for a definition.
 *
 * @param fields - What the panel asks.
 * @returns The request.
 */
function asked(fields: Partial<DataOf<'definition'>>): DataOf<'definition'> {
  return {
    kind: 'definition',
    id: 'error-rate',
    builder: 'search-ratio',
    connector: 'events',
    filters: [],
    options: {},
    ...fields,
  };
}

describe('a panel built from a definition', () => {
  test('copies the body and keeps how the panel presents it', () => {
    const expanded = expandDefinition(asked({ options: { by: 'platform' } }), [errorRate]);
    expect(expanded.request).toMatchObject({
      kind: 'search-ratio',
      connector: 'events',
      index: 'core_events',
      by: 'platform',
      of: [{ field: 'event_name', value: 'START' }],
    });
    expect(expanded.mark).toEqual({ id: 'error-rate', version: 3 });
  });

  test('keeps the body over the panel where both say what the term means', () => {
    const options = { match: [{ field: 'event_name', value: 'ERROR' }] };
    const expanded = expandDefinition(asked({ options }), [errorRate]);
    expect(JSON.stringify(expanded.request)).toContain('data.business_error');
  });

  test('adds a segment to the panel’s own filters', () => {
    const request = asked({
      id: 'prod',
      builder: 'search-series',
      filters: [{ field: 'platform', value: 'web' }],
    });
    const expanded = expandDefinition(request, [prod]);
    expect(expanded.request).toMatchObject({
      filters: [
        { field: 'env', value: 'prod' },
        { field: 'platform', value: 'web' },
      ],
    });
  });

  test('says why it cannot: an unknown id, no body for the language, a builder that does not fit', () => {
    expect(() => expandDefinition(asked({ id: 'churn' }), [errorRate])).toThrow(
      'No definition "churn". The definitions are: error-rate.',
    );
    expect(() => expandDefinition(asked({ builder: 'sql-ratio' }), [errorRate])).toThrow(
      'has no checked filters for sql on events. Build the panel from its meaning',
    );
    expect(() => expandDefinition(asked({ builder: 'search-series' }), [errorRate])).toThrow(
      '"error-rate" is a ratio: build it with search-ratio.',
    );
  });

  test('builds into queries and records the definition it came from', () => {
    const built = buildData(asked({}), { saved: [], definitions: [errorRate] });
    expect(built.definition).toEqual({ id: 'error-rate', version: 3 });
    expect(built.queries[0]).toMatchObject({ connector: 'events', language: 'search' });
  });
});
