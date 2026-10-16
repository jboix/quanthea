/** The `@` mention being typed at the end of the composer's text, and the panels it matches. */

/** A panel the person can mention. */
export interface MentionablePanel {
  /** The panel id. */
  readonly id: string;
  /** Its title, written `@Title` in the message. */
  readonly title: string;
}

/** An `@` being typed: where it starts and what follows it. */
export interface MentionTyped {
  /** The index of the `@` in the text. */
  readonly start: number;
  /** What follows the `@`, up to the end of the text. */
  readonly query: string;
}

/** The most panels the menu lists. */
const menuSize = 6;

/**
 * The `@` being typed at the end of a text, if any. A mention already complete, a panel's whole
 * title followed by a space, is not being typed any more.
 *
 * @param text - The text.
 * @param panels - The panels that can be mentioned.
 * @returns The `@` and what follows it, or `undefined`.
 */
export function mentionAt(
  text: string,
  panels: readonly MentionablePanel[],
): MentionTyped | undefined {
  const match = /(?:^|\s)@([^@\n]{0,60})$/.exec(text);
  if (!match) return undefined;
  const query = match[1] ?? '';
  const lower = query.toLowerCase();
  if (panels.some((panel) => lower.startsWith(`${panel.title.toLowerCase()} `))) return undefined;
  return { start: text.length - query.length - 1, query };
}

/**
 * The panels whose title holds what was typed, those starting with it first.
 *
 * @param query - What follows the `@`.
 * @param panels - The panels.
 * @returns At most six panels.
 */
export function mentionMatches(
  query: string,
  panels: readonly MentionablePanel[],
): MentionablePanel[] {
  const needle = query.trim().toLowerCase();
  const holding = panels.filter((panel) => panel.title.toLowerCase().includes(needle));
  const starting = holding.filter((panel) => panel.title.toLowerCase().startsWith(needle));
  const others = holding.filter((panel) => !starting.includes(panel));
  return [...starting, ...others].slice(0, menuSize);
}

/**
 * The rest of a title after what was typed, shown greyed after the cursor.
 *
 * @param title - The title of the panel the menu has chosen.
 * @param query - What follows the `@`.
 * @returns The rest, or an empty string when the title does not start with what was typed.
 */
export function mentionGhost(title: string, query: string): string {
  return title.toLowerCase().startsWith(query.toLowerCase()) ? title.slice(query.length) : '';
}
