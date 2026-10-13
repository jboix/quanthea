import { describe, expect, test } from 'bun:test';
import { intervalParam, intervalVariable, pickedOption } from './interval-choice.ts';

describe('the interval chip', () => {
  test('offers the choice nobody made first, then the others', () => {
    expect(intervalVariable(['auto', '30m', '1h'])).toMatchObject({
      name: 'interval',
      options: ['auto', '30m', '1h'],
      default: 'auto',
    });
  });

  test('reads an option it offers, and the first one for nothing', () => {
    const options = ['auto', '30m', '1h'] as const;
    expect(pickedOption('1h', options)).toBe('1h');
    expect(pickedOption('auto', options)).toBe('auto');
    expect(pickedOption([], options)).toBe('auto');
  });

  test('never reads an interval it does not offer, or a duration of its own', () => {
    const options = ['as stored', '30m', '1h'] as const;
    expect(pickedOption('1m', options)).toBe('as stored');
    expect(pickedOption('7m', options)).toBe('as stored');
  });

  test('reads a URL parameter only when it is of the closed list', () => {
    expect(intervalParam('10m')).toBe('10m');
    expect(intervalParam('2m')).toBeUndefined();
    expect(intervalParam(null)).toBeUndefined();
  });
});
