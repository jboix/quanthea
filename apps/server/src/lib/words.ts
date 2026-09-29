/**
 * The meaningful words of a question or a name, for matching one against the other without a
 * model: lowercase, split on anything but letters and digits, short and filler words dropped, and
 * a plural s removed, so `http_requests_total` and "HTTP request errors" share `http` and `request`.
 */

/** Words that say nothing about which data a question is about. */
const fillerWords: ReadonlySet<string> = new Set(
  'the and for with what how show from that this are was per all any can you want see over time last day yesterday today hour hours week dashboard panel chart graph around happened'.split(
    ' ',
  ),
);

/**
 * A word's plain form, so `errors` finds `error`.
 *
 * @param word - The word, lowercase.
 * @returns The word without a plural s.
 */
function stem(word: string): string {
  return word.length > 4 && word.endsWith('s') ? word.slice(0, -1) : word;
}

/**
 * The meaningful words of a text or a name.
 *
 * @param text - The text.
 * @returns The words.
 */
export function meaningfulWords(text: string): Set<string> {
  const words = text.toLowerCase().split(/[^a-z0-9]+/);
  return new Set(words.filter((word) => word.length >= 3 && !fillerWords.has(word)).map(stem));
}

/**
 * How many words two sets share.
 *
 * @param first - One set of words.
 * @param second - The other.
 * @returns The count.
 */
export function sharedWords(first: ReadonlySet<string>, second: ReadonlySet<string>): number {
  let count = 0;
  for (const word of first) if (second.has(word)) count += 1;
  return count;
}
