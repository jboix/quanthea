import { expect, test } from 'bun:test';
import type { DashboardSpec } from '@quanthea/shared';
import { withAutoIntervals } from './auto-interval.ts';

const spec = {
  variables: [
    { kind: 'interval', name: 'interval', options: ['auto', '1m', '1h'], default: 'auto' },
    { kind: 'text', name: 'service', default: 'auto' },
  ],
} as unknown as DashboardSpec;

const day = { from: new Date('2026-10-13T00:00:00Z'), to: new Date('2026-10-14T00:00:00Z') };

test('auto takes the usual interval of the range', () => {
  const variables = { interval: { value: 'auto', duration: true }, service: { value: 'auto' } };
  expect(withAutoIntervals(spec, variables, day)).toEqual({
    interval: { value: '10m', duration: true },
    service: { value: 'auto' },
  });
});

test('auto gets coarser when the chart has room for fewer points', () => {
  const variables = { interval: { value: 'auto', duration: true } };
  expect(withAutoIntervals(spec, variables, day, 40).interval?.value).toBe('1h');
});

test('auto takes the interval the caller cuts its charts into', () => {
  const variables = { interval: { value: 'auto', duration: true } };
  expect(withAutoIntervals(spec, variables, day, 40, '30m').interval?.value).toBe('30m');
});

test('a chosen duration stays as it is', () => {
  const variables = { interval: { value: '1m', duration: true } };
  expect(withAutoIntervals(spec, variables, day)).toBe(variables);
});
