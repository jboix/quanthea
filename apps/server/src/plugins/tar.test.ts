import { describe, expect, test } from 'bun:test';
import { ArchiveError, gunzip, readTar } from './tar.ts';
import { tarball } from './test/tarball.ts';

const wanted = new Set(['package/package.json', 'package/dist/plugin.js']);

/**
 * Reads the wanted files of a tarball.
 *
 * @param entries - The tarball's entries.
 * @returns The files, as text, by path.
 */
function read(entries: Parameters<typeof tarball>[0]): Record<string, string> {
  const files = readTar(gunzip(tarball(entries), 1_000_000), wanted);
  return Object.fromEntries(
    [...files].map(([path, data]) => [path, new TextDecoder().decode(data)]),
  );
}

describe('readTar', () => {
  test('reads the wanted files and nothing else', () => {
    expect(
      read([
        { path: 'package/package.json', data: '{"name":"x"}' },
        { path: 'package/README.md', data: 'hello' },
        { path: 'package/dist/plugin.js', data: 'export const kitVersion = 1;' },
      ]),
    ).toEqual({
      'package/package.json': '{"name":"x"}',
      'package/dist/plugin.js': 'export const kitVersion = 1;',
    });
  });

  test('refuses absolute paths, .. segments and backslashes, wherever they are', () => {
    for (const path of ['/etc/passwd', 'package/../../x', 'package\\x.js'])
      expect(() => read([{ path, data: 'x' }])).toThrow(ArchiveError);
  });

  test('refuses symbolic and hard links, even to files it would not read', () => {
    expect(() => read([{ path: 'package/dist/plugin.js', type: '2' }])).toThrow(
      'link or a special file',
    );
    expect(() => read([{ path: 'package/other', type: '1' }])).toThrow('link or a special file');
  });

  test('refuses a wanted file that appears twice, and a corrupt header', () => {
    const twice = { path: 'package/package.json', data: '{}' };
    expect(() => read([twice, twice])).toThrow('appears twice');
    expect(() => read([{ ...twice, corrupt: true }])).toThrow('corrupt');
  });

  test('refuses what is not gzip, or grows past the limit once uncompressed', () => {
    expect(() => gunzip(new TextEncoder().encode('plain'), 1000)).toThrow('not gzip');
    const big = tarball([{ path: 'package/big', data: new Uint8Array(200_000) }]);
    expect(() => gunzip(big, 100_000)).toThrow('more than 100000 bytes');
  });
});
