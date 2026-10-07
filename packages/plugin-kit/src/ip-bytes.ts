/**
 * IP addresses as bytes, so a check sees one address however it is written: IPv6 with `::`,
 * leading zeros, any case, a zone, or an IPv4 address inside it.
 */

/** A dotted IPv4 address. */
const dottedIpv4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** One IPv6 group. */
const hexGroup = /^[0-9a-f]{1,4}$/i;

/**
 * Parses a dotted IPv4 address.
 *
 * @param text - The address.
 * @returns Its 4 bytes, or `undefined` when it is not a dotted IPv4 address.
 */
export function ipv4Bytes(text: string): number[] | undefined {
  if (!dottedIpv4.test(text)) return undefined;
  const bytes = text.split('.').map(Number);
  return bytes.every((byte) => byte <= 255) ? bytes : undefined;
}

/**
 * Parses the groups on one side of `::`.
 *
 * @param part - The groups, separated by `:`; empty for none.
 * @param last - Whether the part ends the address, where a dotted IPv4 address may stand for the
 *   last two groups.
 * @returns The 16-bit groups, or `undefined` when one is malformed.
 */
function groupsOf(part: string, last: boolean): number[] | undefined {
  if (part === '') return [];
  const pieces = part.split(':');
  const tail = pieces.at(-1) ?? '';
  const ipv4 = last ? ipv4Bytes(tail) : undefined;
  const hex = ipv4 ? pieces.slice(0, -1) : pieces;
  if (!hex.every((piece) => hexGroup.test(piece))) return undefined;
  const groups = hex.map((piece) => Number.parseInt(piece, 16));
  if (!ipv4) return groups;
  const [a = 0, b = 0, c = 0, d = 0] = ipv4;
  return [...groups, (a << 8) | b, (c << 8) | d];
}

/**
 * Fills the groups a `::` stands for.
 *
 * @param head - The groups before it.
 * @param tail - The groups after it.
 * @returns The 8 groups, or `undefined` when `::` would stand for none.
 */
function expanded(head: readonly number[], tail: readonly number[]): number[] | undefined {
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return undefined;
  return [...head, ...new Array<number>(missing).fill(0), ...tail];
}

/**
 * Parses an IPv6 address.
 *
 * @param text - The address, without brackets; a zone (`%eth0`) is ignored.
 * @returns Its 16 bytes, or `undefined` when it is not an IPv6 address.
 */
export function ipv6Bytes(text: string): number[] | undefined {
  const halves = text.replace(/%.*$/, '').split('::');
  if (halves.length > 2) return undefined;
  const compressed = halves.length === 2;
  const head = groupsOf(halves[0] ?? '', !compressed);
  const tail = compressed ? groupsOf(halves[1] ?? '', true) : [];
  if (!head || !tail) return undefined;
  const groups = compressed ? expanded(head, tail) : head;
  if (groups?.length !== 8) return undefined;
  return groups.flatMap((group) => [group >> 8, group & 255]);
}

/**
 * Whether bytes start with a prefix.
 *
 * @param bytes - The bytes.
 * @param prefix - The prefix.
 * @returns `true` when the first bytes are the prefix.
 */
export function startsWith(bytes: readonly number[], prefix: readonly number[]): boolean {
  return prefix.every((byte, index) => bytes[index] === byte);
}

/** The prefixes whose last 32 bits are an IPv4 address: compatible, mapped, translated, NAT64. */
const ipv4InLast32 = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255],
  [0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 0, 0],
  [0, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0],
];

/** The local-use NAT64 prefix, 64:ff9b:1::/48. */
const localNat64 = [0, 0x64, 0xff, 0x9b, 0, 1];

/** Where an IPv4 address sits under a NAT64 prefix of 48, 56, 64 or 96 bits (RFC 6052). */
const nat64Layouts = [
  [6, 7, 9, 10],
  [7, 9, 10, 11],
  [9, 10, 11, 12],
  [12, 13, 14, 15],
];

/** The 6to4 prefix, 2002::/16, followed by an IPv4 address. */
const sixToFour = [0x20, 0x02];

/**
 * The IPv4 addresses an IPv6 address may carry: in its last 32 bits under the compatible,
 * mapped, translated and well-known NAT64 prefixes, at each RFC 6052 place under the local-use
 * NAT64 prefix, and after the 6to4 prefix.
 *
 * @param bytes - The 16 bytes of an IPv6 address.
 * @returns The embedded IPv4 addresses, as 4 bytes each; none for any other address.
 */
export function embeddedIpv4(bytes: readonly number[]): number[][] {
  if (ipv4InLast32.some((prefix) => startsWith(bytes, prefix))) return [bytes.slice(12)];
  if (startsWith(bytes, localNat64))
    return nat64Layouts.map((layout) => layout.map((index) => bytes[index] ?? 0));
  if (startsWith(bytes, sixToFour)) return [bytes.slice(2, 6)];
  return [];
}
