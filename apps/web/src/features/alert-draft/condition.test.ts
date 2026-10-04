import { describe, expect, test } from 'bun:test';
import { type AlertSpec, alertSpecSchema } from '@quanthea/shared';
import {
  byWords,
  durationWords,
  everyWords,
  roundThreshold,
  thresholdWords,
  withBy,
  withEvery,
  withFor,
  withThreshold,
} from './condition.ts';
import { templateProblem } from './template-editor.tsx';

const spec: AlertSpec = alertSpecSchema.parse({
  specVersion: 1,
  title: 'Checkout 5xx',
  query: { refId: 'A', connector: 'events', language: 'sql', sql: 'SELECT 1' },
  value: { format: { $fmt: 'percent', decimals: 1 }, by: ['service'] },
  condition: { kind: 'threshold', op: 'above', value: 0.02, for: '5m' },
  every: '1m',
  lookback: '5m',
  severity: 'critical',
  notify: { repeatEvery: '2m' },
  message: { title: '{alert}', body: '{value}' },
});

describe('the condition as a sentence', () => {
  test('reads its values in words', () => {
    expect(byWords(spec)).toBe('each service');
    expect(thresholdWords(spec)).toBe('above 2%');
    expect(thresholdWords(spec, 0.031)).toBe('above 3.1%');
    expect(durationWords('5m')).toBe('5 minutes');
    expect(durationWords('0m')).toBe('at once');
    expect(everyWords('1m')).toBe('every minute');
  });

  test('changes one value and keeps the spec valid', () => {
    expect(withThreshold(spec, 'below', 0.5).condition).toMatchObject({ op: 'below', value: 0.5 });
    expect(withBy(spec, ' service , route ').value.by).toEqual(['service', 'route']);
    expect(withBy(spec, '').value.by).toBeUndefined();
    // A longer `for` stretches the window; a slower check slows the repeat.
    expect(withFor(spec, '10m')).toMatchObject({ lookback: '10m', condition: { for: '10m' } });
    expect(withEvery(spec, '5m')).toMatchObject({ every: '5m', notify: { repeatEvery: '5m' } });
    for (const changed of [withFor(spec, '10m'), withEvery(spec, '5m')])
      expect(alertSpecSchema.safeParse(changed).success).toBe(true);
  });

  test('rounds a dragged threshold to three significant digits', () => {
    expect(roundThreshold(0.0234567)).toBe(0.0235);
    expect(roundThreshold(1234.5)).toBe(1230);
  });

  test('refuses unknown placeholders in the template, as the schema does', () => {
    expect(templateProblem('{alert} at {value}')).toBeUndefined();
    expect(templateProblem('{alert} {nope}')).toContain('Unknown placeholder {nope}');
    expect(templateProblem(' ')).toBe('Write something here.');
  });
});
