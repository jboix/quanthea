/**
 * The words of a panel's explanation: its text cut into paragraphs, and the line that says when it
 * was written and by whose request. Plain text only: nothing the model writes is read as markup.
 */

/** The months' short names, the same in every browser whatever its locale data. */
const monthNames = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');

/**
 * Cuts an explanation into paragraphs, dropping any citation marker such as `[1]`: an
 * explanation cites nothing, and a stray marker would point nowhere.
 *
 * @param text - The explanation, its paragraphs separated by blank lines.
 * @returns The paragraphs, trimmed, none empty.
 */
export function explanationParagraphs(text: string): string[] {
  return text
    .replace(/ ?\[\d{1,2}\]/g, '')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== '');
}

/**
 * Describes a day with its year, in a time zone.
 *
 * @param instant - Epoch milliseconds.
 * @param timeZone - An IANA time zone.
 * @returns Such as `3 Oct 2026`.
 */
function dayWithYear(instant: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    timeZone,
  }).formatToParts(new Date(instant));
  const part = (type: string) => parts.find((each) => each.type === type)?.value ?? '';
  const month = monthNames[Number(part('month')) - 1] ?? part('month');
  return `${part('day')} ${month} ${part('year')}`;
}

/**
 * Says when an explanation was written, and for whom. The date matters: the schema's
 * descriptions it read may have changed since.
 *
 * @param explanation - When and for whom.
 * @param explanation.explainedAt - When, in epoch milliseconds.
 * @param explanation.explainedBy - The name of who asked for it.
 * @param timeZone - An IANA time zone.
 * @returns Such as `Explained on 3 Oct 2026 for Ana`.
 */
export function explainedLine(
  explanation: { readonly explainedAt: number; readonly explainedBy: string },
  timeZone: string,
): string {
  const day = dayWithYear(explanation.explainedAt, timeZone);
  return `Explained on ${day} for ${explanation.explainedBy}`;
}
