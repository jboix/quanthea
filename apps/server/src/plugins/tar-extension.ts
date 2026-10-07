/**
 * Reads tar extended headers, pax `x` and `g` and GNU `L`, as node-tar (npm's reader) reads them.
 * A header that node-tar would read differently from its own length prefixes, or only in part, is
 * refused, so the path and size they give are the ones npm shows.
 */
import { ArchiveError, type Extension, text } from './tar-header.ts';

/** The largest extended header accepted, in bytes. */
const maxExtended = 64 * 1024;

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

/**
 * Reads one pax record, `<length> <key>=<value>`, its trailing line break removed. The length
 * counts every byte of the record, line break included. node-tar splits a header on line breaks
 * and skips a line whose length does not match, so such a line is refused here, and so is a
 * leading zero or a NUL, which node-tar would read differently.
 *
 * @param line - The record.
 * @returns The key and the value.
 * @throws {ArchiveError} When the record is malformed.
 */
function paxRecord(line: string): [string, string] {
  const [, length, key, value] = /^([1-9]\d*) ([^=]+)=(.*)$/s.exec(line) ?? [];
  const bytes = new TextEncoder().encode(line).length + 1;
  if (key === undefined || value === undefined || Number(length) !== bytes || value.includes('\0'))
    throw new ArchiveError('a pax header is malformed');
  return [key, value];
}

/**
 * The records of a pax header, a key given twice keeping its last value, as node-tar does. An
 * empty header has none.
 *
 * @param data - The extended header's data.
 * @returns The values, by key.
 * @throws {ArchiveError} When the header is larger than {@link maxExtended} or malformed.
 */
function paxRecords(data: Uint8Array): Map<string, string> {
  checkExtendedSize(data);
  if (data.length === 0) return new Map();
  const content = new TextDecoder().decode(data);
  if (!content.endsWith('\n')) throw new ArchiveError('a pax header is malformed');
  return new Map(content.slice(0, -1).split('\n').map(paxRecord));
}

/**
 * A pax size record's value.
 *
 * @param size - The record's value, when the header has one.
 * @returns The size, when there is one.
 * @throws {ArchiveError} When it is not a decimal number.
 */
function paxSize(size: string | undefined): number | undefined {
  if (size === undefined) return undefined;
  if (!/^\d+$/.test(size)) throw new ArchiveError('a pax header is malformed');
  return Number(size);
}

/**
 * What an extended header (pax `x` or GNU `L`) adds to the ones before it. A GNU long name is cut
 * at its first NUL as node-tar cuts it; a pax header gives its last `path` and its `size`.
 *
 * @param type - The extended header's type.
 * @param data - Its data.
 * @param before - What the extended headers before it gave.
 * @returns What they give together.
 * @throws {ArchiveError} When the header is larger than {@link maxExtended}, malformed, or gives a
 *   size that is not a decimal number.
 */
export function readExtension(type: string, data: Uint8Array, before: Extension): Extension {
  checkExtendedSize(data);
  if (type === 'L') return { ...before, path: text(data, 0, data.length) };
  const records = paxRecords(data);
  const path = records.get('path');
  const size = paxSize(records.get('size'));
  return {
    ...before,
    ...(path === undefined ? {} : { path }),
    ...(size === undefined ? {} : { size }),
  };
}

/**
 * Checks a pax global header, which would set the path or the size of every entry after it.
 *
 * @param data - Its data.
 * @throws {ArchiveError} When it sets a path or a size, or is malformed.
 */
export function checkGlobal(data: Uint8Array): void {
  const records = paxRecords(data);
  if (records.has('path') || records.has('size'))
    throw new ArchiveError('a global pax header sets a path or a size');
}
