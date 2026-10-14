import { describe, expect, test } from 'bun:test';
import { bodyLanguage, definitionSchema, shapeFits } from './definitions.ts';

const errorRate = {
  id: 'error-rate',
  name: 'Error rate',
  synonyms: ['failure rate'],
  meaning: 'ERROR events, excluding business errors and blocked media, over START events.',
  bodies: [
    {
      shape: 'ratio',
      request: {
        kind: 'search-ratio',
        index: 'core_events',
        match: [{ field: 'event_name', value: 'ERROR' }],
        of: [{ field: 'event_name', value: 'START' }],
      },
    },
  ],
};

describe('a definition', () => {
  test('takes a meaning and a checked body in the language of its builder', () => {
    const parsed = definitionSchema.parse(errorRate);
    expect(parsed.bodies[0] && bodyLanguage(parsed.bodies[0])).toBe('search');
  });

  test('needs a meaning, short enough to read on every turn', () => {
    expect(definitionSchema.safeParse({ ...errorRate, meaning: '' }).success).toBe(false);
    expect(definitionSchema.safeParse({ ...errorRate, meaning: 'x'.repeat(301) }).success).toBe(
      false,
    );
  });

  test('refuses two bodies for one language, and a body whose builder does not fit', () => {
    const twice = { ...errorRate, bodies: [errorRate.bodies[0], errorRate.bodies[0]] };
    expect(JSON.stringify(definitionSchema.safeParse(twice).error)).toContain('Two bodies');
    const measured = { shape: 'measure', request: { kind: 'search-ratio' } };
    const misfit = definitionSchema.safeParse({ ...errorRate, bodies: [measured] });
    expect(JSON.stringify(misfit.error)).toContain('cannot be written with search-ratio');
  });

  test('keeps an id to lowercase letters, digits and dashes', () => {
    expect(definitionSchema.safeParse({ ...errorRate, id: 'Error rate' }).success).toBe(false);
  });
});

describe('a shape', () => {
  test('fits the builders that can carry it', () => {
    expect(shapeFits('ratio', 'sql-ratio')).toBe(true);
    expect(shapeFits('ratio', 'ratio')).toBe(true);
    expect(shapeFits('ratio', 'search-series')).toBe(false);
    expect(shapeFits('measure', 'search-stat')).toBe(true);
    expect(shapeFits('measure', 'sql-rows')).toBe(false);
    expect(shapeFits('segment', 'sql-rows')).toBe(true);
  });
});
