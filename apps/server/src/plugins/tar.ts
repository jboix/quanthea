/**
 * Reads the two files a plugin needs out of an npm tarball, which is untrusted input: gunzipped up
 * to a size limit, then read entry by entry. An entry with an absolute path, a `..` segment or a
 * backslash, a link of any kind, a header whose checksum is wrong, or a wanted file that appears
 * twice makes the whole archive refused. Nothing is written to disk here; the installer writes
 * only the files this returns.
 */
import { gunzipSync } from 'node:zlib';

/** Why an archive is refused. */
export class ArchiveError extends Error {}

/** The size of a tar block. */
const block = 512;

/** Entry types that hold no file of their own and are skipped: directories and global headers. */
const skipped = new Set(['5', 'g']);

/** The largest extended header (pax `x` or GNU `L`) accepted, in bytes. */
const maxExtended = 64 * 1024;

/** Entry types that are regular files. */
const regular = new Set(['0', '\0']);

/** A tar header's fields, as read. */
interface Header {
  /** The entry's path. */
  readonly path: string;
  /** Its data size, in bytes. */
  readonly size: number;
  /** Its type flag. */
  readonly type: string;
}

/**
 * Gunzips an archive, refusing one that would grow past a size.
 *
 * @param compressed - The `.tgz` bytes.
 * @param maxBytes - The most bytes it may hold once uncompressed.
 * @returns The tar bytes.
 * @throws {ArchiveError} When it is not gzip or grows too large.
 */
export function gunzip(compressed: Uint8Array, maxBytes: number): Uint8Array {
  try {
    return new Uint8Array(gunzipSync(compressed, { maxOutputLength: maxBytes }));
  } catch (error) {
    const tooLarge = error instanceof RangeError || /maxOutputLength|buffer/i.test(String(error));
    throw new ArchiveError(
      tooLarge
        ? `the archive holds more than ${maxBytes} bytes once uncompressed`
        : 'the archive is not gzip',
    );
  }
}

/**
 * A NUL-terminated text field of a header.
 *
 * @param header - The header.
 * @param start - The field's offset.
 * @param length - Its length.
 * @returns The text.
 */
function text(header: Uint8Array, start: number, length: number): string {
  const field = header.subarray(start, start + length);
  const end = field.indexOf(0);
  return new TextDecoder().decode(end === -1 ? field : field.subarray(0, end));
}

/**
 * An octal number field of a header.
 *
 * @param header - The header.
 * @param start - The field's offset.
 * @param length - Its length.
 * @returns The number.
 * @throws {ArchiveError} When the field is not octal.
 */
function octal(header: Uint8Array, start: number, length: number): number {
  const digits = text(header, start, length).trim();
  if (!/^[0-7]+$/.test(digits)) throw new ArchiveError('a tar header has a malformed number');
  return Number.parseInt(digits, 8);
}

/**
 * Checks a header's checksum: the sum of its bytes, the checksum field counted as spaces.
 *
 * @param header - The header.
 * @throws {ArchiveError} When it does not match.
 */
function checkSum(header: Uint8Array): void {
  let sum = 0;
  for (let index = 0; index < block; index += 1)
    sum += index >= 148 && index < 156 ? 32 : (header[index] ?? 0);
  if (sum !== octal(header, 148, 8)) throw new ArchiveError('a tar header is corrupt');
}

/**
 * Reads a header.
 *
 * @param header - The 512 bytes.
 * @returns The header's fields.
 */
function readHeader(header: Uint8Array): Header {
  checkSum(header);
  const name = text(header, 0, 100);
  const prefix = text(header, 257, 6).startsWith('ustar') ? text(header, 345, 155) : '';
  const path = prefix ? `${prefix}/${name}` : name;
  return { path, size: octal(header, 124, 12), type: String.fromCharCode(header[156] ?? 0) };
}

/**
 * Checks an entry's path and type.
 *
 * @param header - The entry.
 * @throws {ArchiveError} For an absolute path, `..`, a backslash, or a link or device.
 */
function checkEntry(header: Header): void {
  const segments = header.path.split('/');
  if (header.path.startsWith('/') || header.path.includes('\\') || segments.includes('..'))
    throw new ArchiveError(`the archive has an unsafe path: ${header.path}`);
  if (!regular.has(header.type) && !skipped.has(header.type) && !'xL'.includes(header.type))
    throw new ArchiveError(`the archive holds a link or a special file: ${header.path}`);
}

/**
 * The path an extended header (pax `x` or GNU `L`) gives the next entry, if any. A GNU long name
 * ends at its first NUL.
 *
 * @param header - The extended header.
 * @param data - Its data.
 * @returns The path, or `undefined`.
 * @throws {ArchiveError} When the extended header is larger than {@link maxExtended}.
 */
function extendedPath(header: Header, data: Uint8Array): string | undefined {
  if (data.length > maxExtended)
    throw new ArchiveError(`an extended header is larger than ${maxExtended} bytes`);
  if (header.type === 'L') return text(data, 0, data.length);
  const content = new TextDecoder().decode(data);
  return /(?:^|\n)\d+ path=([^\n]*)\n/.exec(content)?.[1];
}

/** An entry of an archive: its header and its data. */
interface Entry {
  /** The header, its path from an extended header when one came before. */
  readonly header: Header;
  /** The data. */
  readonly data: Uint8Array;
}

/**
 * The raw entries of a tar archive, in order, extended headers included.
 *
 * @param tar - The uncompressed archive.
 * @yields Each entry, its path as its own header gives it.
 * @throws {ArchiveError} For a corrupt header or an archive that ends inside a file.
 */
function* rawEntries(tar: Uint8Array): Generator<Entry> {
  let offset = 0;
  while (offset + block <= tar.length) {
    const raw = tar.subarray(offset, offset + block);
    if (raw.every((byte) => byte === 0)) return;
    const header = readHeader(raw);
    const data = tar.subarray(offset + block, offset + block + header.size);
    if (data.length !== header.size) throw new ArchiveError('the archive ends inside a file');
    offset += block + Math.ceil(header.size / block) * block;
    yield { header, data };
  }
}

/**
 * The entries of a tar archive, each with the path an extended header before it gave, checked.
 *
 * @param tar - The uncompressed archive.
 * @yields Each file or directory entry.
 * @throws {ArchiveError} For an unsafe path, a link or a special file.
 */
function* entries(tar: Uint8Array): Generator<Entry> {
  let longPath: string | undefined;
  for (const entry of rawEntries(tar)) {
    if ('xL'.includes(entry.header.type)) {
      longPath = extendedPath(entry.header, entry.data);
      continue;
    }
    const header = longPath === undefined ? entry.header : { ...entry.header, path: longPath };
    longPath = undefined;
    checkEntry(header);
    yield { header, data: entry.data };
  }
}

/**
 * Reads the wanted regular files of a tar archive.
 *
 * @param tar - The uncompressed archive.
 * @param wanted - The paths to read, such as `package/package.json`.
 * @returns The files found, by path.
 * @throws {ArchiveError} For a malformed or unsafe archive, or a wanted file that appears twice.
 */
export function readTar(tar: Uint8Array, wanted: ReadonlySet<string>): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  for (const { header, data } of entries(tar)) {
    if (!regular.has(header.type) || !wanted.has(header.path)) continue;
    if (files.has(header.path)) throw new ArchiveError(`${header.path} appears twice`);
    files.set(header.path, data.slice());
  }
  return files;
}
