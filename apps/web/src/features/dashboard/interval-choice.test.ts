import { describe, expect, test } from 'bun:test';
import { intervalParam, intervalVariable, pickedInterval } from './interval-choice.ts';

describe('the interval chip', () => {
  test('offers the choice nobody made first, then the intervals of the period', () => {
    expect(intervalVariable(['30m', '1h'], 'auto')).toMatchObject({
      name: 'interval',
      options: ['auto', '30m', '1h'],
      default: 'auto',
    });
  });

  test('reads an interval of the period, and nothing for the automatic choice', () => {
    expect(pickedInterval('1h', ['30m', '1h'])).toBe('1h');
    expect(pickedInterval('auto', ['30m', '1h'])).toBeNull();
    expect(pickedInterval([], ['30m', '1h'])).toBeNull();
  });

  test('never reads an interval the period does not offer, or a duration of its own', () => {
    expect(pickedInterval('1m', ['30m', '1h'])).toBeNull();
    expect(pickedInterval('7m', ['30m', '1h'])).toBeNull();
  });

  test('reads a URL parameter only when it is of the closed list', () => {
    expect(intervalParam('10m')).toBe('10m');
    expect(intervalParam('2m')).toBeUndefined();
    expect(intervalParam(null)).toBeUndefined();
  });
});
