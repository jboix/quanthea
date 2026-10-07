import { describe, expect, test } from 'bun:test';
import { docVersions, pickVersions } from './versions.ts';

describe('the versions of the docs', () => {
  test('keep the latest patch of each minor from v0.3 on, newest first', () => {
    const tags = [
      'v0.1.0',
      'v0.2.0',
      'v0.3.0',
      'v0.3.2',
      'v0.3.1',
      'v0.4.0',
      'v1.0.0-rc.1',
      'x',
      'plugin-kit-v0.3.1',
    ];
    expect(pickVersions(tags)).toEqual([
      { id: 'v0.4', tag: 'v0.4.0' },
      { id: 'v0.3', tag: 'v0.3.2' },
    ]);
  });

  test('put the latest release at docs/, older ones under their id, and main under next', () => {
    const versions = docVersions([
      { id: 'v0.4', tag: 'v0.4.0' },
      { id: 'v0.3', tag: 'v0.3.2' },
    ]);
    expect(
      versions.map((version) => [version.id, version.path, version.ref, version.latest]),
    ).toEqual([
      ['v0.4', 'docs/', 'v0.4.0', true],
      ['v0.3', 'docs/v0.3/', 'v0.3.2', false],
      ['next', 'docs/next/', 'main', false],
    ]);
  });

  test('show main at docs/ before the first release', () => {
    expect(docVersions([])).toEqual([
      { id: 'next', label: 'next (main)', path: 'docs/', ref: 'main', latest: true, next: true },
    ]);
  });
});
