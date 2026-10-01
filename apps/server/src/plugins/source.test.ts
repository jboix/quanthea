import { describe, expect, test } from 'bun:test';
import { parsePackageSpec, resolveVersion } from './source.ts';

describe('package specs', () => {
  test('split a name from its version or range, scoped or not', () => {
    expect(parsePackageSpec('querent-plugin-sqlite')).toEqual({
      name: 'querent-plugin-sqlite',
      range: undefined,
    });
    expect(parsePackageSpec('@acme/querent-plugin-sqlite@^1.2.0')).toEqual({
      name: '@acme/querent-plugin-sqlite',
      range: '^1.2.0',
    });
    expect(() => parsePackageSpec('lodash@4')).toThrow('is not a plugin package');
  });

  test('resolve to the latest tag, a tag, or the highest version in the range', () => {
    const metadata = {
      'dist-tags': { latest: '1.2.0', next: '2.0.0-beta.1' },
      versions: { '1.0.0': {}, '1.2.0': {}, '1.10.1': {}, '2.0.0-beta.1': {} },
    };
    expect(resolveVersion(metadata, undefined)).toBe('1.2.0');
    expect(resolveVersion(metadata, 'next')).toBe('2.0.0-beta.1');
    expect(resolveVersion(metadata, '^1.0.0')).toBe('1.10.1');
    expect(resolveVersion(metadata, '1.0.0')).toBe('1.0.0');
    expect(() => resolveVersion(metadata, '^3')).toThrow('no version satisfies ^3');
  });
});
