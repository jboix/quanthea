/**
 * The words of a panel's explanation: its text cut into paragraphs, the line that says when it
 * was written and by whose request, and the note of one written for an earlier version. Plain
 * text only: nothing the model writes is read as markup.
 */
import { calendarParts } from '@quanthea/shared';

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
  const { day, month, year } = calendarParts(instant, timeZone);
  return `${day} ${month} ${year}`;
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

/** What a panel shows as its explanation, as far as the note of an earlier version needs. */
export interface ShownExplanation {
  /** The explanation shown, with the version it was written for, or `null`. */
  readonly explanation: { readonly version: number } | null;
  /** Whether the panel's queries or view differ from that version's. */
  readonly panelChanged: boolean;
}

/**
 * Says that an explanation was written for an earlier version than the one shown, and whether the
 * panel changed since. An explanation of the version shown needs no note.
 *
 * @param shown - What the panel shows, `undefined` while it loads.
 * @param shownVersion - The version shown.
 * @returns Such as `Written for v2. The panel changed since.`, or `null`.
 */
export function earlierVersionNote(
  shown: ShownExplanation | undefined,
  shownVersion: number,
): string | null {
  const version = shown?.explanation?.version;
  if (version === undefined || version === shownVersion) return null;
  if (shown?.panelChanged) return `Written for v${version}. The panel changed since.`;
  return `Written for v${version}. The panel's query and view are the same in v${shownVersion}.`;
}
