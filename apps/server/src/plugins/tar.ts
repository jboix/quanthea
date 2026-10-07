/**
 * Reads the two files a plugin needs out of an npm tarball, which is untrusted input: gunzipped up
 * to a size limit, then read entry by entry. Headers and extended headers are read as node-tar
 * reads them, so the files are the ones npm shows. An entry with an absolute path, a `..` segment
 * or a backslash, a link of any kind, a header whose checksum is wrong, an extended header that is
 * malformed, over 64 KiB or that node-tar would read differently, a global header that sets a path
 * or a size, anything node-tar would skip or read elsewhere, or a wanted file that appears twice
 * makes the whole archive refused. Nothing is written to disk here; the installer writes only the
 * files this returns.
 */
import { gunzipSync } from 'node:zlib';
import { checkGlobal, readExtension } from './tar-extension.ts';
import {
  ArchiveError,
  block,
  checkEntry,
  type Extension,
  type Header,
  readHeader,
  resolve,
} from './tar-header.ts';

export { ArchiveError } from './tar-header.ts';

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

/** An entry of an archive: its header and its data. */
interface Entry {
  /** The header, its path and size from extended headers when some came before. */
  readonly header: Header;
  /** The data. */
  readonly data: Uint8Array;
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
 * Whether a block is all zeros: an end-of-archive block.
 *
 * @param bytes - The block.
 * @returns Whether every byte is zero.
 */
function isZero(bytes: Uint8Array): boolean {
  return bytes.every((byte) => byte === 0);
}

/**
 * Checks the block after an end-of-archive block. node-tar stops only after two, and reads a
 * header that follows a single one.
 *
 * @param tar - The uncompressed archive.
 * @param offset - Where the block after the first end-of-archive block starts.
 * @throws {ArchiveError} When that block is a header.
 */
function checkEnd(tar: Uint8Array, offset: number): void {
  const next = tar.subarray(offset, offset + block);
  if (next.length === block && !isZero(next))
    throw new ArchiveError('the archive has an entry after the end of the archive');
}

/**
 * What is pending for the next entry after an extended header: what the pax `x` or GNU `L` header
 * adds, or, after a pax global header, what was pending before it.
 *
 * @param header - The header.
 * @param data - Its data.
 * @param extension - What was pending before it.
 * @returns What is pending after it, or nothing when it is a file or a directory.
 * @throws {ArchiveError} For a malformed or ambiguous extended header.
 */
function afterHeader(
  header: Header,
  data: Uint8Array,
  extension: Extension,
): Extension | undefined {
  if (header.type === 'x' || header.type === 'L')
    return readExtension(header.type, data, extension);
  if (header.type !== 'g') return undefined;
  checkGlobal(data);
  return extension;
}

/**
 * The entries of a tar archive, each with the path and size the extended headers before it gave,
 * checked. Extended headers are read, not yielded. A global header leaves a pending extension for
 * the entry after it, as node-tar does.
 *
 * @param tar - The uncompressed archive.
 * @yields Each file or directory entry.
 * @throws {ArchiveError} For a corrupt header, an archive that ends inside a file, an unsafe path,
 *   a link, a special file, or a malformed or ambiguous extended header.
 */
function* entries(tar: Uint8Array): Generator<Entry> {
  let extension: Extension = {};
  for (let offset = 0; offset + block <= tar.length; ) {
    const raw = tar.subarray(offset, offset + block);
    if (isZero(raw)) return checkEnd(tar, offset + block);
    const header = resolve(readHeader(raw), extension);
    checkEntry(header);
    const data = dataOf(tar, offset + block, header.size);
    offset += block + Math.ceil(header.size / block) * block;
    const pending = afterHeader(header, data, extension);
    extension = pending ?? {};
    if (pending === undefined) yield { header, data };
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
    if (header.type !== '0' || !wanted.has(header.path)) continue;
    if (files.has(header.path)) throw new ArchiveError(`${header.path} appears twice`);
    files.set(header.path, data.slice());
  }
  return files;
}
