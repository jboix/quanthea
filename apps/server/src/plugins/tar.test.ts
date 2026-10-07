import { describe, expect, test } from 'bun:test';
import { ArchiveError, gunzip, readTar } from './tar.ts';
import { entryBytes, paxData, tarball } from './test/tarball.ts';

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
        { path: 'package/dist/plugin.js', data: 'export const kitVersion = 0;' },
      ]),
    ).toEqual({
      'package/package.json': '{"name":"x"}',
      'package/dist/plugin.js': 'export const kitVersion = 0;',
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

  test('reads a GNU long name up to its first NUL', () => {
    const name = new TextEncoder().encode('package/package.json\0\0\0junk');
    expect(
      read([
        { path: '././@LongLink', type: 'L', data: name },
        { path: 'package/short', data: '{}' },
      ]),
    ).toEqual({ 'package/package.json': '{}' });
  });

  test('refuses an extended header over 64 KiB, in bounded time', () => {
    const name = new Uint8Array(1_000_000);
    name[name.length - 1] = 0x61;
    const archives = ['L', 'x'].map((type) =>
      gunzip(tarball([{ path: '././@LongLink', type, data: name }]), 2_000_000),
    );
    const started = performance.now();
    for (const archive of archives)
      expect(() => readTar(archive, wanted)).toThrow('extended header is larger than 65536 bytes');
    expect(performance.now() - started).toBeLessThan(1000);
  });

  test('applies a pax size to the next entry, as npm does, and reads what it hides as data', () => {
    const hidden = entryBytes({ path: 'package/package.json', data: '{"hidden":true}' });
    const size = paxData([['size', String(hidden.length)]]);
    expect(
      read([
        { path: 'PaxHeader/README.md', type: 'x', data: size },
        { path: 'package/README.md', data: hidden, size: 0 },
      ]),
    ).toEqual({});
  });

  test('takes the last pax path, as npm does', () => {
    const paths = paxData([
      ['path', 'package/decoy.json'],
      ['path', 'package/package.json'],
    ]);
    expect(
      read([
        { path: 'PaxHeader/x', type: 'x', data: paths },
        { path: 'package/x', data: '{}' },
      ]),
    ).toEqual({ 'package/package.json': '{}' });
  });

  test('refuses a malformed pax header, and a global one that sets a path or a size', () => {
    const entry = { path: 'package/package.json', data: '{}' };
    for (const data of ['99 path=x\n', '5 path=package/x\n', '8 nokey\n', 'path=x\n'])
      expect(() => read([{ path: 'PaxHeader/x', type: 'x', data }, entry])).toThrow(
        'pax header is malformed',
      );
    const badSize = paxData([['size', '-1']]);
    expect(() => read([{ path: 'PaxHeader/x', type: 'x', data: badSize }, entry])).toThrow(
      'pax header is malformed',
    );
    for (const key of ['path', 'size'])
      expect(() =>
        read([{ path: 'pax_global_header', type: 'g', data: paxData([[key, '1']]) }, entry]),
      ).toThrow('global pax header sets');
    const comment = paxData([['comment', 'abc']]);
    expect(read([{ path: 'pax_global_header', type: 'g', data: comment }, entry])).toEqual({
      'package/package.json': '{}',
    });
  });
});
