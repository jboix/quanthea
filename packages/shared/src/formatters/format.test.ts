import { describe, expect, test } from 'bun:test';
import { createFormatter } from './format.ts';
import { type Formatter, formatterSchema } from './schema.ts';

/**
 * Formats values with a formatter.
 *
 * @param formatter - The formatter.
 * @param values - The values.
 * @returns The texts.
 */
function format(formatter: Formatter, ...values: unknown[]): string[] {
  const apply = createFormatter(formatter, {
    timeZone: 'UTC',
    now: Date.parse('2026-09-28T12:00:00Z'),
  });
  return values.map(apply);
}

describe('named formatters', () => {
  test('number: grouping, decimals and compact notation', () => {
    expect(format({ $fmt: 'number' }, 1284, 0.12345, -3.5)).toEqual(['1,284', '0.12', '-3.5']);
    expect(format({ $fmt: 'number', decimals: 0 }, 2.6)).toEqual(['3']);
    expect(format({ $fmt: 'number', compact: true }, 18_412, 2_500_000)).toEqual([
      '18.41K',
      '2.5M',
    ]);
  });

  test('percent: ratios by default, or values already in percent', () => {
    expect(format({ $fmt: 'percent', decimals: 1, input: 'ratio' }, 0.084, 0.003)).toEqual([
      '8.4%',
      '0.3%',
    ]);
    expect(format({ $fmt: 'percent', input: 'percent' }, 42)).toEqual(['42%']);
  });

  test('duration: the largest unit the value reaches', () => {
    expect(format({ $fmt: 'duration', unit: 's' }, 2.9, 0.31, 0.00064, 90, 7200)).toEqual([
      '2.9 s',
      '310 ms',
      '640 µs',
      '1.5 min',
      '2 h',
    ]);
    expect(format({ $fmt: 'duration', unit: 'ms' }, 640, 0)).toEqual(['640 ms', '0 ns']);
  });

  test('bytes and SI prefixes', () => {
    expect(format({ $fmt: 'bytes' }, 1536, 512)).toEqual(['1.5 KiB', '512 B']);
    expect(format({ $fmt: 'bytes', base: 1000 }, 1_500_000)).toEqual(['1.5 MB']);
    expect(format({ $fmt: 'si', unit: 'req/s' }, 2300, 0.004)).toEqual(['2.3 kreq/s', '4 mreq/s']);
    expect(format({ $fmt: 'si' }, 12)).toEqual(['12']);
  });

  test('currency and dates', () => {
    expect(format({ $fmt: 'currency', code: 'EUR' }, 1284.5)).toEqual(['€1,284.50']);
    expect(format({ $fmt: 'currency', code: 'USD', decimals: 0 }, 1284.5)).toEqual(['$1,285']);
    const instant = Date.parse('2026-09-26T14:02:00Z');
    expect(format({ $fmt: 'datetime', pattern: 'time' }, instant)).toEqual(['14:02']);
    expect(format({ $fmt: 'datetime', pattern: 'date' }, instant)).toEqual(['26 Sep']);
    expect(format({ $fmt: 'datetime' }, instant)).toEqual(['26 Sep, 14:02']);
    expect(
      format({ $fmt: 'datetime', pattern: 'relative' }, Date.parse('2026-09-28T11:55:00Z')),
    ).toEqual(['5 minutes ago']);
  });

  test('pass text through, and show nothing for missing values', () => {
    expect(format({ $fmt: 'percent' }, 'n/a', null, undefined, Number.NaN)).toEqual([
      'n/a',
      '',
      '',
      'NaN',
    ]);
    expect(format({ $fmt: 'number' }, '1284')).toEqual(['1,284']);
  });
});

describe('string templates', () => {
  test('replace {value} with the value as it is', () => {
    expect(format('{value} ms', 310, 'x')).toEqual(['310 ms', 'x ms']);
  });
});

describe('formatterSchema', () => {
  test('accepts templates and named formatters, and nothing else', () => {
    expect(formatterSchema.safeParse({ $fmt: 'bytes', base: 1024 }).success).toBe(true);
    expect(formatterSchema.safeParse({ $fmt: 'bytes', base: 1023 }).success).toBe(false);
    expect(formatterSchema.safeParse({ $fmt: 'js', code: 'alert(1)' }).success).toBe(false);
    expect(formatterSchema.safeParse({ $fmt: 'number', extra: 1 }).success).toBe(false);
  });
});
