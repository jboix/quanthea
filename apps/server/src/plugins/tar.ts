/**
 * Reads the two files a plugin needs out of an npm tarball, which is untrusted input: gunzipped up
 * to a size limit, then read entry by entry. Pax and GNU extended headers give the next entry its
 * path and size as node-tar reads them, so the files are the ones npm shows. An entry with an
 * absolute path, a `..` segment or a backslash, a link of any kind, a header whose checksum is
 * wrong, an extended header that is malformed or over 64 KiB, a global header that sets a path or
 * a size, or a wanted file that appears twice makes the whole archive refused. Nothing is written to disk here; the installer writes
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

/** What extended headers give the entry that follows them. */
interface Extension {
  /** The entry's path, in place of its own header's. */
  readonly path?: string;
  /** The entry's data size, in place of its own header's. */
  readonly size?: number;
}

/**
 * Checks an extended header's size before it is read.
 *
 * @param data - Its data.
 * @throws {ArchiveError} When it is larger than {@link maxExtended}.
 */
function checkExtendedSize(data: Uint8Array): void {
  if (data.length > maxExtended)
    throw new ArchiveError(`an extended header is larger than ${maxExtended} bytes`);
}

/** One pax record, `<length> <key>=<value>\n`, and where the next one starts. */
interface PaxRecord {
  /** The key. */
  readonly key: string;
  /** The value. */
  readonly value: string;
  /** The offset after the record. */
  readonly end: number;
}

/**
 * Reads the pax record at an offset, its length prefix counting every byte of the record.
 *
 * @param data - The extended header's data.
 * @param start - The record's offset.
 * @returns The record.
 * @throws {ArchiveError} When the record is malformed.
 */
function paxRecord(data: Uint8Array, start: number): PaxRecord {
  const space = data.indexOf(0x20, start);
  const digits = space === -1 ? '' : text(data, start, space - start);
  const end = start + Number(digits);
  if (!/^\d+$/.test(digits) || end <= space || end > data.length || data[end - 1] !== 0x0a)
    throw new ArchiveError('a pax header is malformed');
  const record = new TextDecoder().decode(data.subarray(space + 1, end - 1));
  const equals = record.indexOf('=');
  if (equals < 1) throw new ArchiveError('a pax header is malformed');
  return { key: record.slice(0, equals), value: record.slice(equals + 1), end };
}

/**
 * The records of a pax header, a key given twice keeping its last value, as node-tar does.
 *
 * @param data - The extended header's data.
 * @returns The values, by key.
 * @throws {ArchiveError} When the header is larger than {@link maxExtended} or malformed.
 */
function paxRecords(data: Uint8Array): Map<string, string> {
  checkExtendedSize(data);
  const records = new Map<string, string>();
  for (let offset = 0; offset < data.length; ) {
    const record = paxRecord(data, offset);
    records.set(record.key, record.value);
    offset = record.end;
  }
  return records;
}

/**
 * What an extended header (pax `x` or GNU `L`) adds to the ones before it. A GNU long name ends at
 * its first NUL; a pax header gives its last `path` and its `size`.
 *
 * @param header - The extended header.
 * @param data - Its data.
 * @param before - What the extended headers before it gave.
 * @returns What they give together.
 * @throws {ArchiveError} When the header is larger than {@link maxExtended}, malformed, or gives a
 *   size that is not a decimal number.
 */
function readExtension(header: Header, data: Uint8Array, before: Extension): Extension {
  checkExtendedSize(data);
  if (header.type === 'L') return { ...before, path: text(data, 0, data.length) };
  const records = paxRecords(data);
  const path = records.get('path');
  const size = records.get('size');
  if (size !== undefined && !/^\d+$/.test(size))
    throw new ArchiveError('a pax header is malformed');
  return {
    ...before,
    ...(path === undefined ? {} : { path }),
    ...(size === undefined ? {} : { size: Number(size) }),
  };
}

/**
 * Checks a pax global header, which would set the path or the size of every entry after it.
 *
 * @param data - Its data.
 * @throws {ArchiveError} When it sets a path or a size, or is malformed.
 */
function checkGlobal(data: Uint8Array): void {
  const records = paxRecords(data);
  if (records.has('path') || records.has('size'))
    throw new ArchiveError('a global pax header sets a path or a size');
}

/** An entry of an archive: its header and its data. */
interface Entry {
  /** The header, its path and size from extended headers when some came before. */
  readonly header: Header;
  /** The data. */
  readonly data: Uint8Array;
}

/**
 * A header with what extended headers before it gave. Extended headers keep their own fields.
 *
 * @param header - The header, as read.
 * @param extension - What the extended headers before it gave.
 * @returns The header to use.
 */
function extend(header: Header, extension: Extension): Header {
  if ('xL'.includes(header.type)) return header;
  return { ...header, path: extension.path ?? header.path, size: extension.size ?? header.size };
}

/**
 * An entry's data.
 *
 * @param tar - The uncompressed archive.
 * @param start - Where the data starts.
 * @param size - Its size.
 * @returns The data.
 * @throws {ArchiveError} When the archive ends inside it.
 */
function dataOf(tar: Uint8Array, start: number, size: number): Uint8Array {
  const data = tar.subarray(start, start + size);
  if (data.length !== size) throw new ArchiveError('the archive ends inside a file');
  return data;
}

/**
 * The entries of a tar archive, each with the path and size the extended headers before it gave,
 * checked. Extended headers are read, not yielded.
 *
 * @param tar - The uncompressed archive.
 * @yields Each file, directory or global header entry.
 * @throws {ArchiveError} For a corrupt header, an archive that ends inside a file, an unsafe path,
 *   a link, a special file, or a malformed or ambiguous extended header.
 */
function* entries(tar: Uint8Array): Generator<Entry> {
  let extension: Extension = {};
  for (let offset = 0; offset + block <= tar.length; ) {
    const raw = tar.subarray(offset, offset + block);
    if (raw.every((byte) => byte === 0)) return;
    const header = extend(readHeader(raw), extension);
    const data = dataOf(tar, offset + block, header.size);
    offset += block + Math.ceil(header.size / block) * block;
    if ('xL'.includes(header.type)) {
      extension = readExtension(header, data, extension);
      continue;
    }
    extension = {};
    checkEntry(header);
    if (header.type === 'g') checkGlobal(data);
    yield { header, data };
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
