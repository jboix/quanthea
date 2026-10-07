/**
 * Reads one tar header as node-tar, npm's reader, reads it, so the path and size quanthea takes
 * are the ones npm shows. Where the two could differ, the header is refused instead.
 */

/** Why an archive is refused. */
export class ArchiveError extends Error {}

/** The size of a tar block. */
export const block = 512;

/** The POSIX magic and version, the only ones under which node-tar joins the prefix to the name. */
const posixMagic = new TextEncoder().encode('ustar\u000000');

/** The entry types node-tar counts as file system entries, the only ones extended headers apply to. */
const fileSystemTypes = new Set(['0', '1', '2', '3', '4', '5', '6', '7', 'D']);

/** The entry types accepted: files, directories, and pax and GNU long name extended headers. */
const acceptedTypes = new Set(['0', '5', 'x', 'g', 'L']);

/** The extended header types, whose own path is never checked. */
const extendedTypes = new Set(['x', 'g', 'L']);

/** A header's fields, as its 512 bytes give them. */
export interface RawHeader {
  /** The name field. */
  readonly name: string;
  /** The prefix joined to the path, when node-tar joins one. */
  readonly prefix?: string;
  /** The data size, in bytes. */
  readonly size: number;
  /** The type flag, `0` for a NUL one. */
  readonly type: string;
}

/** A header with what extended headers before it gave. */
export interface Header {
  /** The entry's path. */
  readonly path: string;
  /** Its data size, in bytes. */
  readonly size: number;
  /** Its type flag. */
  readonly type: string;
}

/** What extended headers give the entry that follows them. */
export interface Extension {
  /** The entry's path, in place of its own name field. */
  readonly path?: string;
  /** The entry's data size, in place of its own header's. */
  readonly size?: number;
}

/**
 * A text field, decoded as UTF-8, its first NUL dropped with what follows up to the next line
 * break, as node-tar decodes it.
 *
 * @param bytes - The bytes holding the field.
 * @param start - The field's offset.
 * @param length - Its length.
 * @returns The text.
 */
export function text(bytes: Uint8Array, start: number, length: number): string {
  return new TextDecoder().decode(bytes.subarray(start, start + length)).replace(/\0.*/, '');
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
 * The prefix node-tar joins to a header's path: only under the POSIX magic, 155 bytes long when
 * its last byte is set and joined even when empty then, 130 bytes long and joined when not empty
 * otherwise.
 *
 * @param header - The header.
 * @returns The prefix, or nothing when none is joined.
 */
function prefixOf(header: Uint8Array): string | undefined {
  const magic = header.subarray(257, 265);
  if (!magic.every((byte, index) => byte === posixMagic[index])) return undefined;
  if (header[475] !== 0) return text(header, 345, 155);
  return text(header, 345, 130) || undefined;
}

/**
 * Reads a header's fields.
 *
 * @param header - The 512 bytes.
 * @returns The fields.
 * @throws {ArchiveError} When the checksum or a number is wrong.
 */
export function readHeader(header: Uint8Array): RawHeader {
  checkSum(header);
  const prefix = prefixOf(header);
  return {
    name: text(header, 0, 100),
    ...(prefix === undefined ? {} : { prefix }),
    size: octal(header, 124, 12),
    type: text(header, 156, 1) || '0',
  };
}

/**
 * A header with what the extended headers before it gave, which apply to file system entries only:
 * an extended header keeps its own fields. An extended path replaces the prefix and the name.
 *
 * @param raw - The header's own fields.
 * @param extension - What the extended headers before it gave.
 * @returns The header to use.
 */
export function resolve(raw: RawHeader, extension: Extension): Header {
  const own = fileSystemTypes.has(raw.type) ? extension : {};
  const joined = raw.prefix === undefined ? raw.name : `${raw.prefix}/${raw.name}`;
  return { path: own.path ?? joined, size: own.size ?? raw.size, type: raw.type };
}

/**
 * Checks an entry's type and, for a file or a directory, its path.
 *
 * @param header - The entry.
 * @throws {ArchiveError} For a link or a special file, or an absolute path, `..` or a backslash.
 */
export function checkEntry(header: Header): void {
  if (!acceptedTypes.has(header.type))
    throw new ArchiveError(`the archive holds a link or a special file: ${header.path}`);
  if (extendedTypes.has(header.type)) return;
  const segments = header.path.split('/');
  if (header.path.startsWith('/') || header.path.includes('\\') || segments.includes('..'))
    throw new ArchiveError(`the archive has an unsafe path: ${header.path}`);
}
