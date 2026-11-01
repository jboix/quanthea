import { describe, expect, test } from 'bun:test';
import { naturalCompare } from './natural.ts';

describe('natural order', () => {
  test('reads runs of digits as numbers and the rest as text in any case', () => {
    const versions = ['2.10', 'v10', '2.9', 'V9', '10', '2.9.1', 'beta', 'Alpha', '02'];
    expect([...versions].sort(naturalCompare)).toEqual([
      '02',
      '2.9',
      '2.9.1',
      '2.10',
      '10',
      'Alpha',
      'beta',
      'V9',
      'v10',
    ]);
  });
});
