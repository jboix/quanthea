import { describe, expect, test } from 'bun:test';
import { type Mapping, mappingsSchema, mapValue } from './tones.ts';

/** The tone a value takes under some mappings, or the text when the mapping has no tone. */
const toneOf = (mappings: readonly Mapping[], value: unknown) => {
  const mapped = mapValue(mappings, value);
  return mapped?.tone ?? mapped?.text;
};

describe('mapValue', () => {
  test('matches a value as it reads, whatever its type', () => {
    const mappings: Mapping[] = [
      { match: { value: 'ok' }, text: 'Healthy', tone: 'good' },
      { match: { value: 200 }, tone: 'series2' },
      { match: { value: '404' }, tone: 'warning' },
    ];
    expect(mapValue(mappings, 'ok')).toEqual({
      match: { value: 'ok' },
      text: 'Healthy',
      tone: 'good',
    });
    expect(toneOf(mappings, 200)).toBe('series2');
    expect(toneOf(mappings, '200')).toBe('series2');
    expect(toneOf(mappings, 404)).toBe('warning');
    expect(mapValue(mappings, 'OK')).toBeUndefined();
    expect(mapValue(mappings, { ok: true })).toBeUndefined();
    expect(mapValue(mappings, null)).toBeUndefined();
  });

  test('matches a boolean, and the text that writes it', () => {
    const mappings: Mapping[] = [
      { match: { value: true }, text: 'Yes', tone: 'good' },
      { match: { value: false }, text: 'No' },
    ];
    expect(toneOf(mappings, true)).toBe('good');
    expect(toneOf(mappings, 'true')).toBe('good');
    expect(toneOf(mappings, false)).toBe('No');
    expect(mapValue(mappings, 1)).toBeUndefined();
  });

  test('matches no value with null, and nothing else with it', () => {
    const mappings: Mapping[] = [{ match: { null: true }, text: 'none', tone: 'neutral' }];
    expect(toneOf(mappings, null)).toBe('neutral');
    expect(toneOf(mappings, undefined)).toBe('neutral');
    expect(mapValue(mappings, 0)).toBeUndefined();
    expect(mapValue(mappings, '')).toBeUndefined();
    expect(mapValue(mappings, 'null')).toBeUndefined();
  });

  test('reads a range with its start included and its end excluded', () => {
    const steps: Mapping[] = [
      { match: { to: 2 }, tone: 'good' },
      { match: { from: 2, to: 4 }, tone: 'warning' },
      { match: { from: 4 }, tone: 'bad' },
    ];
    expect(toneOf(steps, -10)).toBe('good');
    expect(toneOf(steps, 1.99)).toBe('good');
    expect(toneOf(steps, 2)).toBe('warning');
    expect(toneOf(steps, 3.99)).toBe('warning');
    expect(toneOf(steps, 4)).toBe('bad');
    expect(toneOf(steps, 1e9)).toBe('bad');
  });

  test('reads a number written as text in a range, and nothing that is not a number', () => {
    const steps: Mapping[] = [{ match: { from: 0 }, tone: 'bad' }];
    expect(toneOf(steps, '12.5')).toBe('bad');
    for (const value of [null, undefined, true, '', ' ', 'fast', Number.NaN, Infinity, [3]])
      expect(mapValue(steps, value)).toBeUndefined();
  });

  test('takes the first mapping that matches', () => {
    const mappings: Mapping[] = [
      { match: { value: 0 }, text: 'idle', tone: 'neutral' },
      { match: { to: 10 }, tone: 'good' },
      { match: { to: 100 }, tone: 'warning' },
    ];
    expect(toneOf(mappings, 0)).toBe('neutral');
    expect(toneOf(mappings, 5)).toBe('good');
    expect(toneOf(mappings, 50)).toBe('warning');
    expect(mapValue(mappings, 500)).toBeUndefined();
  });

  test('maps nothing without mappings', () => {
    expect(mapValue(undefined, 1)).toBeUndefined();
    expect(mapValue([], 1)).toBeUndefined();
  });
});

describe('the mappings a spec may hold', () => {
  /** The messages of what is wrong with some mappings. */
  const problemsOf = (mappings: unknown) =>
    mappingsSchema.safeParse(mappings).error?.issues.map((issue) => issue.message) ?? [];

  test('are a value, null or a range, each with a text, a tone or both', () => {
    const mappings: Mapping[] = [
      { match: { value: 'ok' }, text: 'Healthy' },
      { match: { value: false }, tone: 'bad' },
      { match: { null: true }, text: 'none', tone: 'neutral' },
      { match: { from: 0, to: 0.5 }, tone: 'series8' },
      { match: { from: 0.5 }, tone: 'warning' },
    ];
    expect(mappingsSchema.parse(mappings)).toEqual(mappings);
  });

  test('refuse a match that says two things, nothing, or an empty range', () => {
    const tone = 'good';
    for (const match of [{}, { value: 1, from: 0 }, { null: true, value: 'x' }, { from: 4, to: 2 }])
      expect(problemsOf([{ match, tone }])).toEqual([
        'A match is one of { "value": a text, a number or a boolean }, { "null": true }, or a range { "from"?, "to"? } with at least one bound and "from" below "to".',
      ]);
    expect(problemsOf([{ match: { from: 1, to: 1 }, tone }])).toHaveLength(1);
    expect(problemsOf([{ match: { null: false }, tone }])).toHaveLength(1);
  });

  test('refuse a colour, an unknown tone and a mapping that changes nothing', () => {
    expect(problemsOf([{ match: { value: 1 }, tone: '#ff0000' }])).toHaveLength(1);
    expect(problemsOf([{ match: { value: 1 }, tone: 'series9' }])).toHaveLength(1);
    expect(problemsOf([{ match: { value: 1 }, color: 'red' }]).length).toBeGreaterThan(0);
    expect(problemsOf([{ match: { value: 1 } }])).toEqual([
      'A mapping gives a "text", a "tone", or both.',
    ]);
  });

  test('are at most twenty', () => {
    const mapping = { match: { value: 1 }, tone: 'good' };
    expect(mappingsSchema.safeParse(Array(20).fill(mapping)).success).toBe(true);
    expect(mappingsSchema.safeParse(Array(21).fill(mapping)).success).toBe(false);
  });
});
