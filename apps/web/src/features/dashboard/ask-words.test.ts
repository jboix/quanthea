import { describe, expect, test } from 'bun:test';
import { type DashboardSpec, dashboardSpecSchema } from '@quanthea/shared';
import { absoluteRangeLabel, answerSegments, contextLabel, variableWords } from './ask-words.ts';

/**
 * A spec with a single-value and a multi-value variable.
 *
 * @returns The spec.
 */
function spec(): DashboardSpec {
  return dashboardSpecSchema.parse({
    specVersion: 1,
    title: 'Checkout',
    time: { from: '2026-09-26T11:30:00Z', to: '2026-09-26T13:00:00Z' },
    variables: [
      { kind: 'custom', name: 'env', options: ['prod', 'staging'], default: 'prod' },
      { kind: 'custom', name: 'service', options: ['api', 'web'], multi: true, default: ['api'] },
    ],
    panels: [],
  });
}

describe('answer segments', () => {
  test('cuts the text into words and markers, at their offsets', () => {
    expect(answerSegments('Errors rose [1] after the deploy [12].')).toEqual([
      { kind: 'text', at: 0, text: 'Errors rose ' },
      { kind: 'marker', at: 12, n: 1 },
      { kind: 'text', at: 15, text: ' after the deploy ' },
      { kind: 'marker', at: 33, n: 12 },
      { kind: 'text', at: 37, text: '.' },
    ]);
  });

  test('leaves markup and other brackets as text', () => {
    const text = '<b>bold</b> [x] [123]';
    expect(answerSegments(text)).toEqual([{ kind: 'text', at: 0, text }]);
  });
});

describe('labels', () => {
  test('names a range with absolute times in the time zone, the day once', () => {
    const range = { from: Date.parse('2026-09-26T11:30:00Z'), to: Date.parse('2026-09-26T13:00Z') };
    expect(absoluteRangeLabel(range, 'Europe/Zurich')).toBe('26 Sep 13:30–15:00');
    const night = { from: Date.parse('2026-09-26T20:00:00Z'), to: Date.parse('2026-09-27T01:00Z') };
    expect(absoluteRangeLabel(night, 'Europe/Zurich')).toBe('26 Sep 22:00 – 27 Sep 03:00');
  });

  test('says what a question will be asked about: the range shown and the values', () => {
    const shown = { spec: spec(), time: undefined, variables: {}, timeZone: 'Europe/Zurich' };
    expect(contextLabel({ ...shown, now: 0 })).toBe(
      'Ask about this dashboard, as shown: 26 Sep 13:30–15:00, $env prod, $service api',
    );
    const now = Date.parse('2026-09-26T14:00:00Z');
    const lastHour = { from: 'now-1h', to: 'now' };
    const chosen = { env: 'staging', service: ['api', 'web'] };
    expect(contextLabel({ ...shown, time: lastHour, variables: chosen, now })).toBe(
      'Ask about this dashboard, as shown: 26 Sep 15:00–16:00, $env staging, $service api + web',
    );
  });

  test('names "All" as such', () => {
    expect(variableWords(spec(), { service: ['$__all'] })).toEqual(['$env prod', '$service All']);
  });
});
