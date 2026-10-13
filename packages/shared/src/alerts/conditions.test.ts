import { describe, expect, test } from 'bun:test';
import type { AlertCondition } from '../spec/alert-condition.ts';
import { changeWords, conditionText, readingsText } from './condition-words.ts';
import {
  changeBetween,
  changeHolds,
  changeLimit,
  conditionDirection,
  conditionHolds,
  readingsBeside,
} from './conditions.ts';

const halved = { direction: 'down', amount: 50, unit: 'percent' } as const;
const rose = { direction: 'up', amount: 200, unit: 'absolute' } as const;

describe('a change', () => {
  test('is the share of the earlier point, or the difference', () => {
    expect(changeBetween('percent', { value: 40, reference: 100 })).toBe(-60);
    expect(changeBetween('absolute', { value: 40, reference: 100 })).toBe(-60);
    expect(changeBetween('percent', { value: 150, reference: 100 })).toBe(50);
    // A share of a negative point is counted on its size, so a rise stays a rise.
    expect(changeBetween('percent', { value: -5, reference: -10 })).toBe(50);
  });

  test('cannot be worked out without a value, an earlier point, or as a share of zero', () => {
    expect(changeBetween('percent', { value: null, reference: 100 })).toBeNull();
    expect(changeBetween('percent', { value: 40, reference: null })).toBeNull();
    expect(changeBetween('percent', { value: 40 })).toBeNull();
    expect(changeBetween('percent', { value: 40, reference: 0 })).toBeNull();
    expect(changeBetween('absolute', { value: 40, reference: 0 })).toBe(40);
  });

  test('holds at the amount or more, in its direction only', () => {
    expect(changeHolds(halved, { value: 50, reference: 100 })).toBe(true);
    expect(changeHolds(halved, { value: 51, reference: 100 })).toBe(false);
    expect(changeHolds(halved, { value: 200, reference: 100 })).toBe(false);
    expect(changeHolds(rose, { value: 300, reference: 100 })).toBe(true);
    expect(changeHolds(rose, { value: 299, reference: 100 })).toBe(false);
    expect(changeHolds(rose, { value: -300, reference: 100 })).toBe(false);
  });

  test('holds for a half that rounding puts a hair short', () => {
    expect(changeHolds(halved, { value: 0.15, reference: 0.3 })).toBe(true);
  });

  test('never holds from zero in percent, from a missing point, or without a value', () => {
    expect(changeHolds({ ...rose, unit: 'percent' }, { value: 50, reference: 0 })).toBe(false);
    expect(changeHolds(rose, { value: 500, reference: null })).toBe(false);
    expect(changeHolds(rose, { value: null, reference: 0 })).toBe(false);
    expect(changeHolds(rose, { value: 500, reference: 0 })).toBe(true);
  });

  test('has a limit the value must reach, from its earlier point', () => {
    expect(changeLimit(halved, 80)).toBe(40);
    expect(changeLimit(rose, 80)).toBe(280);
    expect(changeLimit({ ...halved, direction: 'up' }, -80)).toBe(-40);
    expect(changeLimit(halved, null)).toBeNull();
    expect(changeLimit(halved, 0)).toBeNull();
    expect(changeLimit(rose, 0)).toBe(200);
  });
});

/** Error share above 2% with more than 100 requests. */
const both: AlertCondition = {
  kind: 'all',
  of: [
    { kind: 'threshold', op: 'above', value: 0.02 },
    { kind: 'threshold', op: 'above', value: 100, field: 'requests' },
  ],
  for: '5m',
};
const either: AlertCondition = { ...both, kind: 'any' };

describe('a condition', () => {
  test('holds for a single test as the test does', () => {
    const above: AlertCondition = { kind: 'threshold', op: 'above', value: 5, for: '0m' };
    expect(conditionHolds(above, [{ value: 6 }])).toBe(true);
    expect(conditionHolds(above, [{ value: 5 }])).toBe(false);
    expect(conditionHolds(above, [{ value: null }])).toBe(false);
    const dropped: AlertCondition = { kind: 'change', ...halved, within: '10m', for: '0m' };
    expect(conditionHolds(dropped, [{ value: 4, reference: 10 }])).toBe(true);
    expect(conditionHolds(dropped, [{ value: 4, reference: null }])).toBe(false);
  });

  test('joins tests with all or any, each on its own reading', () => {
    expect(conditionHolds(both, [{ value: 0.03 }, { value: 500 }])).toBe(true);
    expect(conditionHolds(both, [{ value: 0.03 }, { value: 50 }])).toBe(false);
    expect(conditionHolds(either, [{ value: 0.03 }, { value: 50 }])).toBe(true);
    expect(conditionHolds(either, [{ value: 0.01 }, { value: 50 }])).toBe(false);
  });

  test('takes a part without a value as not holding', () => {
    expect(conditionHolds(both, [{ value: 0.03 }, { value: null }])).toBe(false);
    expect(conditionHolds(both, [{ value: 0.03 }])).toBe(false);
    expect(conditionHolds(either, [{ value: null }, { value: 500 }])).toBe(true);
  });

  test('never holds for a series when it is about the absence of data', () => {
    expect(conditionHolds({ kind: 'no_data', for: '5m' }, [{ value: 1 }])).toBe(false);
  });

  test('points the way of its first test', () => {
    expect(conditionDirection(both)).toBe('above');
    expect(conditionDirection({ kind: 'change', ...halved, within: '5m', for: '0m' })).toBe(
      'below',
    );
    expect(conditionDirection({ kind: 'no_data', for: '5m' })).toBeUndefined();
  });

  test('keeps readings beside the value only when they say more', () => {
    expect(readingsBeside([{ value: 3 }])).toBeUndefined();
    expect(readingsBeside([{ value: 3, reference: null }])).toHaveLength(1);
    expect(readingsBeside([{ value: 3 }, { value: 4 }])).toHaveLength(2);
  });
});

describe('a condition in words', () => {
  const percent = { value: { format: { $fmt: 'percent', decimals: 1 } as const } };

  test('reads after its subject, each kind in a few words', () => {
    const above: AlertCondition = { kind: 'threshold', op: 'above', value: 0.02, for: '5m' };
    expect(conditionText({ ...percent, condition: above })).toBe('above 2%');
    const dropped: AlertCondition = { kind: 'change', ...halved, within: '10m', for: '0m' };
    expect(conditionText({ value: {}, condition: dropped })).toBe('down 50% or more within 10m');
    const more: AlertCondition = { kind: 'change', ...rose, within: '5m', for: '0m' };
    expect(conditionText({ value: {}, condition: more })).toBe('up 200 or more within 5m');
    expect(conditionText({ value: {}, condition: { kind: 'no_data', for: '5m' } })).toBe('no data');
  });

  test('names the field of each later part, in its own format', () => {
    expect(conditionText({ ...percent, condition: both })).toBe(
      'above 2% and requests above 10,000%',
    );
    const plain = { $fmt: 'number', decimals: 0 } as const;
    const formatted: AlertCondition = {
      ...either,
      of: [both.of[0], { ...both.of[1], format: plain }] as typeof both.of,
    };
    expect(conditionText({ ...percent, condition: formatted })).toBe(
      'above 2% or requests above 100',
    );
    expect(
      readingsText({ ...percent, condition: formatted }, [{ value: 0.024 }, { value: 312 }]),
    ).toBe('2.4%, requests 312');
    expect(
      readingsText({ ...percent, condition: formatted }, [{ value: 0.024 }, { value: null }]),
    ).toBe('2.4%');
  });

  test('never writes a difference of percentages as a share of the earlier value', () => {
    const points = { direction: 'up', amount: 0.05, unit: 'absolute' } as const;
    const share = { direction: 'up', amount: 5, unit: 'percent' } as const;
    const kinds = [
      { kind: 'change', within: '10m', for: '0m' },
      { kind: 'past', ago: '7d', for: '0m' },
    ] as const;
    for (const kind of kinds) {
      const absolute = conditionText({ ...percent, condition: { ...kind, ...points } });
      const relative = conditionText({ ...percent, condition: { ...kind, ...share } });
      expect(absolute).toStartWith('up 5 percentage points or more ');
      expect(relative).toStartWith('up 5% or more ');
    }
    const moved = [{ value: 0.1, reference: 0.05 }];
    const change = { kind: 'change', within: '10m', for: '0m' } as const;
    expect(changeWords({ ...percent, condition: { ...change, ...points } }, moved).change).toBe(
      '+5 percentage points',
    );
    expect(changeWords({ ...percent, condition: { ...change, ...share } }, moved).change).toBe(
      '+100%',
    );
    const one = { ...change, ...points, amount: 0.01 };
    expect(conditionText({ ...percent, condition: one })).toBe(
      'up 1 percentage point or more within 10m',
    );
    expect(conditionText({ value: {}, condition: { ...change, ...points } })).toBe(
      'up 0.05 or more within 10m',
    );
  });

  test('writes how far a change moved, and from where', () => {
    const dropped: AlertCondition = { kind: 'change', ...halved, within: '10m', for: '0m' };
    const spec = { value: {}, condition: dropped };
    expect(changeWords(spec, [{ value: 48, reference: 100 }])).toEqual({
      change: '-52%',
      previous: '100',
    });
    expect(changeWords(spec, [{ value: 48, reference: null }])).toEqual({
      change: '',
      previous: '',
    });
    expect(changeWords(spec, [{ value: 48, reference: 0 }])).toEqual({ change: '', previous: '0' });
    const more: AlertCondition = { kind: 'change', ...rose, within: '5m', for: '0m' };
    expect(
      changeWords({ value: {}, condition: more }, [{ value: 330, reference: 100 }]).change,
    ).toBe('+230');
    expect(changeWords({ value: {}, condition: both }, [{ value: 1 }, { value: 2 }])).toEqual({
      change: '',
      previous: '',
    });
  });
});
