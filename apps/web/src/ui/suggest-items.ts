/** What a suggesting input lists for the text typed, and whether a name is one it knows. */

/** The suggestions listed for a text. */
export interface SuggestionList {
  /** The names listed, the ones that start with the text first. */
  readonly items: readonly string[];
  /** How many matching names the list leaves out. */
  readonly more: number;
}

/**
 * The names that match what was typed: every word typed appears in the name, in any case. Names
 * that start with the text come first, and the list stops at a limit so a large catalogue stays
 * quick to draw.
 *
 * @param names - The names on offer, in order.
 * @param text - What was typed.
 * @param limit - The most names listed.
 * @returns The names listed and how many more match.
 */
export function suggestionsFor(names: readonly string[], text: string, limit = 50): SuggestionList {
  const typed = text.trim().toLowerCase();
  const words = typed.split(/\s+/).filter(Boolean);
  const matches = names.filter((name) => {
    const lower = name.toLowerCase();
    return words.every((word) => lower.includes(word));
  });
  const starts = (name: string) => typed !== '' && name.toLowerCase().startsWith(typed);
  const ordered = [...matches.filter(starts), ...matches.filter((name) => !starts(name))];
  return { items: ordered.slice(0, limit), more: Math.max(0, ordered.length - limit) };
}

/**
 * Whether a name is one of the names on offer, in any case.
 *
 * @param names - The names on offer.
 * @param name - The name.
 * @returns `true` when a name on offer equals it.
 */
export function isSuggested(names: readonly string[], name: string): boolean {
  const lower = name.trim().toLowerCase();
  return names.some((candidate) => candidate.toLowerCase() === lower);
}

/**
 * The highlighted place after an arrow key. No place, `-1`, is the typed text itself, so Enter
 * takes what was typed until an arrow picks a suggestion.
 *
 * @param current - The highlighted place, or `-1` for none.
 * @param step - `1` for down, `-1` for up.
 * @param count - How many suggestions are listed.
 * @returns The new place, kept between `-1` and the last suggestion.
 */
export function movedHighlight(current: number, step: 1 | -1, count: number): number {
  return Math.max(-1, Math.min(current + step, count - 1));
}
