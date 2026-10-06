import { describe, expect, test } from 'bun:test';
import { fittedNumber } from './fitted-number.ts';

describe('fitted number', () => {
  test('keeps a number on one line, smaller as it grows longer', () => {
    expect(fittedNumber('212', 32)).toEqual({
      fontSize: 'min(32px, 53.76cqi)',
      whiteSpace: 'nowrap',
    });
    expect(fittedNumber('CHF 5,779,599', 32).fontSize).toBe('min(32px, 12.41cqi)');
  });

  test('takes an empty value as one character', () => {
    expect(fittedNumber('', 26).fontSize).toBe('min(26px, 161.29cqi)');
  });
});
