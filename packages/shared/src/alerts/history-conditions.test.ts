import { describe, expect, test } from 'bun:test';
import type { AlertCondition } from '../spec/alert-condition.ts';
import { bandText, changeWords, conditionText } from './condition-words.ts';
import { bandHolds, bandLimits, conditionDirection, conditionHolds } from './conditions.ts';
import { notificationValues } from './notification-values.ts';
import { replayUnder } from './replay-steps.ts';

const lastWeek: AlertCondition = {
  kind: 'past',
  direction: 'up',
  amount: 30,
  unit: 'percent',
  ago: '7d',
  for: '0m',
};
const band: AlertCondition = {
  kind: 'band',
  side: 'either',
  deviations: 3,
  baseline: '1d',
  for: '0m',
};
const usual = { reference: 10, spread: 1 };

describe('a comparison with the past', () => {
  test('holds at the amount or more, the way it points', () => {
    expect(conditionHolds(lastWeek, [{ value: 130, reference: 100 }])).toBe(true);
    expect(conditionHolds(lastWeek, [{ value: 129, reference: 100 }])).toBe(false);
    expect(conditionHolds(lastWeek, [{ value: 60, reference: 100 }])).toBe(false);
    const down: AlertCondition = { ...lastWeek, direction: 'down' };
    expect(conditionHolds(down, [{ value: 60, reference: 100 }])).toBe(true);
    const more: AlertCondition = { ...lastWeek, unit: 'absolute' };
    expect(conditionHolds(more, [{ value: 30, reference: 0 }])).toBe(true);
  });

  test('never holds without a value then, without a value now, or as a share of zero', () => {
    expect(conditionHolds(lastWeek, [{ value: 130, reference: null }])).toBe(false);
    expect(conditionHolds(lastWeek, [{ value: 130 }])).toBe(false);
    expect(conditionHolds(lastWeek, [{ value: null, reference: 100 }])).toBe(false);
    expect(conditionHolds(lastWeek, [{ value: 130, reference: 0 }])).toBe(false);
    expect(conditionHolds(lastWeek, [])).toBe(false);
  });

  test('reads in a few words, and names how far the value is from the value then', () => {
    const spec = { value: {}, condition: lastWeek };
    expect(conditionText(spec)).toBe('up 30% or more from a week earlier');
    expect(conditionText({ value: {}, condition: { ...lastWeek, ago: '1h' } })).toBe(
      'up 30% or more from an hour earlier',
    );
    expect(changeWords(spec, [{ value: 140, reference: 100 }])).toEqual({
      change: '+40%',
      previous: '100',
    });
    expect(bandText(spec, [{ value: 140, reference: 100 }])).toBe('');
    expect(conditionDirection(lastWeek)).toBe('above');
  });
});

describe('a band', () => {
  test('reaches the deviations each side of the mean', () => {
    expect(bandLimits({ deviations: 3 }, usual)).toEqual({ lower: 7, upper: 13 });
    expect(bandLimits({ deviations: 0.5 }, usual)).toEqual({ lower: 9.5, upper: 10.5 });
    expect(bandLimits({ deviations: 3 }, { reference: 10, spread: 0 })).toEqual({
      lower: 10,
      upper: 10,
    });
  });

  test('is none with too little history', () => {
    expect(bandLimits({ deviations: 3 }, { reference: null, spread: null })).toBeNull();
    expect(bandLimits({ deviations: 3 }, { reference: 10 })).toBeNull();
    expect(bandLimits({ deviations: 3 }, undefined)).toBeNull();
    expect(conditionHolds(band, [{ value: 1e9, reference: null, spread: null }])).toBe(false);
    expect(conditionHolds(band, [{ value: 1e9 }])).toBe(false);
  });

  test('holds strictly outside it, on the side it names', () => {
    expect(conditionHolds(band, [{ value: 13.01, ...usual }])).toBe(true);
    expect(conditionHolds(band, [{ value: 13, ...usual }])).toBe(false);
    expect(conditionHolds(band, [{ value: 6.99, ...usual }])).toBe(true);
    expect(conditionHolds(band, [{ value: 7, ...usual }])).toBe(false);
    expect(conditionHolds(band, [{ value: null, ...usual }])).toBe(false);
    expect(bandHolds({ side: 'above', deviations: 3 }, { value: 2, ...usual })).toBe(false);
    expect(bandHolds({ side: 'below', deviations: 3 }, { value: 20, ...usual })).toBe(false);
  });

  test('of a history that never moved is its one value, zero included', () => {
    const flat = { reference: 0, spread: 0 };
    expect(conditionHolds(band, [{ value: 0, ...flat }])).toBe(false);
    expect(conditionHolds(band, [{ value: 1, ...flat }])).toBe(true);
    expect(conditionHolds(band, [{ value: -1, ...flat }])).toBe(true);
  });

  test('reads in a few words, and names its edges in the value’s format', () => {
    const percent = { $fmt: 'percent', decimals: 1 } as const;
    const spec = { value: { format: percent }, condition: band };
    expect(conditionText(spec)).toBe('more than 3 deviations from its mean of the last 1d');
    const above: AlertCondition = { ...band, side: 'above', deviations: 1 };
    expect(conditionText({ value: {}, condition: above })).toBe(
      'more than 1 deviation above its mean of the last 1d',
    );
    expect(bandText(spec, [{ value: 0.05, reference: 0.018, spread: 0.002 }])).toBe('1.2% to 2.4%');
    expect(bandText(spec, [{ value: 0.05, reference: null, spread: null }])).toBe('');
    expect(changeWords(spec, [{ value: 0.05, reference: 0.018, spread: 0.002 }])).toEqual({
      change: '',
      previous: '',
    });
    expect(conditionDirection(band)).toBe('above');
    expect(conditionDirection({ ...band, side: 'below' })).toBe('below');
  });

  test('as a part of a joined condition is named by its field', () => {
    const joined: AlertCondition = {
      kind: 'all',
      of: [
        { kind: 'threshold', op: 'above', value: 100 },
        { kind: 'band', side: 'above', deviations: 3, baseline: '1d', field: 'latency' },
      ],
      for: '5m',
    };
    expect(conditionText({ value: {}, condition: joined })).toBe(
      'above 100 and latency more than 3 deviations above its mean of the last 1d',
    );
    const readings = [{ value: 120 }, { value: 9, reference: 4, spread: 1 }];
    expect(conditionHolds(joined, readings)).toBe(true);
    expect(bandText({ value: {}, condition: joined }, readings)).toBe('1 to 7');
  });
});

describe('the message of a condition that reads history', () => {
  const base = {
    specVersion: 1 as const,
    title: 'Orders',
    value: {},
    severity: 'warning' as const,
    timezone: 'UTC',
  };

  test('names the band, the change and the value then', () => {
    const series = { labels: {}, value: 14, since: 0 };
    const inBand = notificationValues(
      { ...base, condition: band } as never,
      { ...series, readings: [{ value: 14, ...usual }] },
      '/alerts/a1',
    );
    expect(inBand).toMatchObject({ value: '14', band: '7 to 13', change: '', previous: '' });
    const moved = notificationValues(
      { ...base, condition: lastWeek } as never,
      { ...series, readings: [{ value: 14, reference: 10 }] },
      '/alerts/a1',
    );
    expect(moved).toMatchObject({ band: '', change: '+40%', previous: '10' });
    const bare = notificationValues({ ...base, condition: band } as never, series, '/alerts/a1');
    expect(bare).toMatchObject({ value: '14', band: '' });
  });
});

describe('a replay judged again in the browser', () => {
  const points = [10, 10, 12.5, 14, 10].map((value, index) => ({
    at: index * 60_000,
    value,
    readings: [{ value, ...usual }],
  }));

  test('moves with the width and the side of a band', () => {
    expect(replayUnder(points, band, '1m', 240_000).firing).toEqual([
      { from: 180_000, to: 240_000, ongoing: false },
    ]);
    const narrow: AlertCondition = { ...band, deviations: 2 };
    expect(replayUnder(points, narrow, '1m', 240_000).firing).toEqual([
      { from: 120_000, to: 240_000, ongoing: false },
    ]);
    expect(replayUnder(points, { ...band, side: 'below' }, '1m', 240_000).firings).toBe(0);
  });

  test('moves with the amount of a comparison with the past', () => {
    const then = points.map((point) => ({
      ...point,
      readings: [{ value: point.value, reference: 10 }],
    }));
    expect(replayUnder(then, lastWeek, '1m', 240_000).firings).toBe(1);
    expect(replayUnder(then, { ...lastWeek, amount: 20 }, '1m', 240_000).firing[0]?.from).toBe(
      120_000,
    );
  });
});
