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

  test('refuses a pax record whose value holds a newline, which npm would read as two', () => {
    const data = `${paxData([['path', 'package/package.json']])}41 comment=a\n28 path=package/benign.json\n`;
    expect(() =>
      read([
        { path: 'PaxHeader/x', type: 'x', data },
        { path: 'package/x', data: '{}' },
      ]),
    ).toThrow('pax header is malformed');
  });

  test('keeps a pending pax path and size across a global header, as npm does', () => {
    const path = paxData([['path', 'package/package.json']]);
    const global = paxData([['comment', 'c']]);
    expect(
      read([
        { path: 'PaxHeader/x', type: 'x', data: path },
        { path: 'pax_global_header', type: 'g', data: global },
        { path: 'package/benign', data: '{}' },
      ]),
    ).toEqual({ 'package/package.json': '{}' });
    const hidden = entryBytes({ path: 'package/package.json', data: '{"hidden":true}' });
    const size = paxData([['size', String(hidden.length)]]);
    expect(
      read([
        { path: 'PaxHeader/x', type: 'x', data: size },
        { path: 'pax_global_header', type: 'g', data: global },
        { path: 'package/README.md', data: hidden, size: 0 },
      ]),
    ).toEqual({});
  });

  test('joins the ustar prefix as npm does: only under the POSIX magic, never to a pax path', () => {
    expect(
      read([{ path: 'package/package.json', data: '{}', prefix: 'decoy', magic: 'ustar  \0' }]),
    ).toEqual({ 'package/package.json': '{}' });
    const path = paxData([['path', 'package/package.json']]);
    expect(
      read([
        { path: 'PaxHeader/x', type: 'x', data: path },
        { path: 'package/x', data: '{}', prefix: 'decoy' },
      ]),
    ).toEqual({ 'package/package.json': '{}' });
    const long = `${'\0'.repeat(130)}x`;
    expect(() => read([{ path: 'package/package.json', data: '{}', prefix: long }])).toThrow(
      'unsafe path',
    );
  });

  test('reads what a directory holds as entries, as npm does, since it reads no data for one', () => {
    const hidden = entryBytes({ path: 'package/package.json', data: '{"hidden":true}' });
    for (const dir of [{ path: 'package/dir', type: '5' }, { path: 'package/dir/' }])
      expect(read([{ ...dir, data: hidden }])).toEqual({
        'package/package.json': '{"hidden":true}',
      });
  });

  test('refuses an entry after a single end-of-archive block, which npm would still read', () => {
    const archive = gunzip(tarball([{ path: 'package/a', data: 'a' }]), 1_000_000);
    const entry = entryBytes({ path: 'package/package.json', data: '{}' });
    const tar = new Uint8Array([...archive.subarray(0, 1536), ...entry, ...new Uint8Array(1024)]);
    expect(() => readTar(tar, wanted)).toThrow('after the end of the archive');
  });

  test('refuses what npm skips or reads elsewhere: a link name, an empty path, a path outside', () => {
    const json = { path: 'package/package.json', data: '{}' };
    expect(() => read([{ ...json, linkpath: 'x' }])).toThrow('link or a special file');
    const linkpath = paxData([['linkpath', 'x']]);
    expect(() => read([{ path: 'PaxHeader/x', type: 'x', data: linkpath }, json])).toThrow(
      'link or a special file',
    );
    for (const path of ['', 'other/package.json', 'package/./package.json', 'package//x'])
      expect(() => read([{ path, data: '{}' }])).toThrow(ArchiveError);
    const empty = paxData([['path', '']]);
    expect(() => read([{ path: 'PaxHeader/x', type: 'x', data: empty }, json])).toThrow('no path');
    expect(read([{ path: '././@LongLink', type: 'L', data: '' }, json])).toEqual({
      'package/package.json': '{}',
    });
  });

  test('refuses an extended header that is not ASCII, which npm may decode in pieces', () => {
    const entry = { path: 'package/package.json', data: '{}' };
    const data = paxData([['path', 'package/é']]);
    for (const type of ['x', 'L'])
      expect(() => read([{ path: 'PaxHeader/x', type, data }, entry])).toThrow('not ASCII');
  });

  test('refuses a checksum that runs into the type flag, which npm would read with it', () => {
    const entry = entryBytes({ path: 'package/package.json', data: '{}' });
    const sum = new TextDecoder().decode(entry.subarray(148, 154));
    entry.set(new TextEncoder().encode(`00${sum}`), 148);
    const tar = new Uint8Array([...entry, ...new Uint8Array(1024)]);
    expect(() => readTar(tar, wanted)).toThrow('corrupt');
  });
});
