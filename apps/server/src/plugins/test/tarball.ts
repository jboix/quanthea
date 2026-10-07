/**
 * Writes tarballs for tests, including ones no packer would write: links, absolute paths, `..`,
 * duplicates, a corrupt checksum and a size that differs from the data, to check the reader
 * refuses them or reads them as npm does.
 */
import { gzipSync } from 'node:zlib';

/** One entry to write. */
export interface TarEntry {
  /** The path. */
  readonly path: string;
  /** The content of a file. */
  readonly data?: string | Uint8Array;
  /** The type flag: `0` for a file (the default), `2` for a symbolic link, `1` for a hard link. */
  readonly type?: string;
  /** Spoil the header's checksum. */
  readonly corrupt?: boolean;
  /** The size the header gives, when it differs from the data's. */
  readonly size?: number;
}

/**
 * Writes a text into a header.
 *
 * @param header - The header.
 * @param value - The text.
 * @param start - The offset.
 */
function put(header: Uint8Array, value: string, start: number): void {
  header.set(new TextEncoder().encode(value), start);
}

/**
 * One entry's header and data, padded to blocks.
 *
 * @param entry - The entry.
 * @returns The bytes.
 */
export function entryBytes(entry: TarEntry): Uint8Array {
  const data =
    typeof entry.data === 'string'
      ? new TextEncoder().encode(entry.data)
      : (entry.data ?? new Uint8Array());
  const header = new Uint8Array(512);
  put(header, entry.path, 0);
  put(header, '0000644\0', 100);
  const size = entry.size ?? data.length;
  put(header, `${size.toString(8).padStart(11, '0')}\0`, 124);
  put(header, '00000000000\0', 136);
  put(header, '        ', 148);
  put(header, entry.type ?? '0', 156);
  put(header, 'ustar\u000000', 257);
  const sum = header.reduce((total, byte) => total + byte, 0) + (entry.corrupt ? 1 : 0);
  put(header, `${sum.toString(8).padStart(6, '0')}\0 `, 148);
  const padded = new Uint8Array(Math.ceil(data.length / 512) * 512);
  padded.set(data);
  return new Uint8Array([...header, ...padded]);
}

/**
 * A gzipped tarball of entries.
 *
 * @param entries - The entries.
 * @returns The `.tgz` bytes.
 */
export function tarball(entries: readonly TarEntry[]): Uint8Array {
  const parts = entries.map(entryBytes);
  const tar = new Uint8Array([...parts.flatMap((part) => [...part]), ...new Uint8Array(1024)]);
  return new Uint8Array(gzipSync(tar));
}

/**
 * The data of a pax extended header: each record prefixed with its own length in bytes.
 *
 * @param records - The keys and values, in order, a key repeated when given twice.
 * @returns The records, as text.
 */
export function paxData(records: readonly (readonly [string, string])[]): string {
  return records
    .map(([key, value]) => {
      const body = ` ${key}=${value}\n`;
      const bodyLength = new TextEncoder().encode(body).length;
      let length = bodyLength + 1;
      while (String(length).length + bodyLength !== length)
        length = String(length).length + bodyLength;
      return `${length}${body}`;
    })
    .join('');
}
