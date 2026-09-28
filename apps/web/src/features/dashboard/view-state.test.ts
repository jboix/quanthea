import { describe, expect, test } from 'bun:test';
import { type DashboardSpec, dashboardSpecSchema } from '@querent/shared';
import { choicesFromSearch, timeLabel, withTime, withVariable } from './view-state.ts';

const spec: DashboardSpec = dashboardSpecSchema.parse({
  specVersion: 1,
  title: 'T',
  time: { from: 'now-6h', to: 'now' },
  variables: [
    { kind: 'custom', name: 'env', options: ['prod', 'staging'], default: 'prod' },
    { kind: 'custom', name: 'services', options: ['a', 'b'], default: ['a'], multi: true },
  ],
  panels: [],
});

describe('view state', () => {
  test('reads the time range and the declared variables from the URL', () => {
    const search = new URLSearchParams(
      'from=now-1h&to=now&var-env=staging&var-services=a&var-services=b&var-other=x',
    );
    expect(choicesFromSearch(search, spec)).toEqual({
      time: { from: 'now-1h', to: 'now' },
      variables: { env: 'staging', services: ['a', 'b'] },
    });
  });

  test('ignores an invalid time range', () => {
    expect(
      choicesFromSearch(new URLSearchParams('from=yesterday&to=now'), spec).time,
    ).toBeUndefined();
  });

  test('writes new choices without losing the others', () => {
    const search = withVariable(
      withTime(new URLSearchParams('var-env=prod'), { from: 'now-7d', to: 'now' }),
      'services',
      ['a', 'b'],
    );
    expect(search.toString()).toBe('var-env=prod&from=now-7d&to=now&var-services=a&var-services=b');
    expect(withTime(search, undefined).toString()).toBe(
      'var-env=prod&var-services=a&var-services=b',
    );
  });

  test('describes relative and absolute ranges', () => {
    expect(timeLabel({ from: 'now-6h', to: 'now' })).toBe('Last 6 hours');
    expect(timeLabel({ from: 'now-1d', to: 'now' })).toBe('Last day');
    expect(
      timeLabel(
        { from: '2026-09-26T13:30:00+02:00', to: '2026-09-26T15:00:00+02:00' },
        'Europe/Madrid',
      ),
    ).toBe('26 Sep, 13:30 – 15:00');
    expect(timeLabel({ from: '2026-09-26T22:00:00Z', to: '2026-09-27T02:00:00Z' }, 'UTC')).toBe(
      '26 Sep, 22:00 – 27 Sep, 02:00',
    );
    expect(timeLabel({ from: 'now-2d', to: 'now-1d' })).toBe('now-2d – now-1d');
  });
});
