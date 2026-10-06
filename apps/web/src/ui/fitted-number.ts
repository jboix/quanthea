/** The size of a number that must stay on one line in a tile of any width. */
import type { CSSProperties } from 'react';

/** How wide a character of a number is, in ems: digits, separators and a currency sign. */
const characterWidth = 0.62;

/**
 * The font size that keeps a number on one line: its size in pixels, or smaller when the tile is
 * too narrow for it. The tile must be a size container (`container-type: inline-size`).
 *
 * @param text - The number as shown, such as `CHF 5,779,599`.
 * @param pixels - Its size when it fits.
 * @returns The style to set on the number.
 */
export function fittedNumber(text: string, pixels: number): CSSProperties {
  const fit = 100 / (characterWidth * Math.max(text.length, 1));
  return { fontSize: `min(${pixels}px, ${fit.toFixed(2)}cqi)`, whiteSpace: 'nowrap' };
}
