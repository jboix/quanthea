/**
 * The natural order of texts: runs of digits compare as numbers, so `2.10` comes after `2.9` and
 * `v10` after `v9`. Other characters compare as text, ignoring case.
 */

/** A run of digits, or of anything else. */
const chunks = /(\d+)/;

/**
 * Orders two texts naturally.
 *
 * @param first - One text.
 * @param second - The other.
 * @returns Negative, zero or positive.
 */
export function naturalCompare(first: string, second: string): number {
  const left = first.split(chunks);
  const right = second.split(chunks);
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const order = compareChunks(left[index] ?? '', right[index] ?? '', index % 2 === 1);
    if (order !== 0) return order;
  }
  // Equal but for leading zeros or case: the shorter split first, then the plain text order.
  return left.length - right.length || first.localeCompare(second);
}

/**
 * Orders two chunks of the same kind.
 *
 * @param left - One chunk.
 * @param right - The other.
 * @param digits - Whether both are runs of digits.
 * @returns Negative, zero or positive.
 */
function compareChunks(left: string, right: string, digits: boolean): number {
  if (!digits) return left.localeCompare(right, 'en', { sensitivity: 'base' });
  return Number(left) - Number(right);
}
