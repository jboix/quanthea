import { describe, expect, test } from 'bun:test';
import { fieldTypeOf, frameValue } from './columns.ts';

describe('fieldTypeOf', () => {
  test('maps number, time and boolean types, and everything else to string', () => {
    expect([20, 21, 23, 700, 701, 1700].map(fieldTypeOf)).toEqual(Array(6).fill('number'));
    expect([1082, 1114, 1184].map(fieldTypeOf)).toEqual(['time', 'time', 'time']);
    expect(fieldTypeOf(16)).toBe('boolean');
    expect([25, 1043, 2950, 3802, 1186].map(fieldTypeOf)).toEqual(Array(5).fill('string'));
  });
});

describe('frameValue', () => {
  test('turns bigint and numeric strings into numbers', () => {
    expect(frameValue('number', '10')).toBe(10);
    expect(frameValue('number', '2.50')).toBe(2.5);
  });

  test('turns dates into epoch milliseconds', () => {
    expect(frameValue('time', new Date('2026-09-27T12:02:00Z'))).toBe(Date.UTC(2026, 8, 27, 12, 2));
  });

  test('keeps nulls, and serializes JSON and arrays as strings', () => {
    expect(frameValue('number', null)).toBeNull();
    expect(frameValue('string', { a: 1 })).toBe('{"a":1}');
    expect(frameValue('string', [1, 2])).toBe('[1,2]');
  });
});
