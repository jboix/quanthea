/**
 * What an open answer marks on the dashboard. Marks are view state only: the cited panels get numbered badges and a citation's window is shaded on its
 * panel's time chart. Nothing goes into the spec.
 */
import type { Answer } from '@quanthea/shared';

/** A cited time window, shaded on a time chart. */
export interface CitedWindow {
  /** The citation's number. */
  readonly n: number;
  /** The start, in epoch milliseconds. */
  readonly from: number;
  /** The end, in epoch milliseconds. */
  readonly to: number;
}

/** What an answer marks on one panel. */
export interface PanelMark {
  /** The numbers of the citations about it, in order. */
  readonly numbers: readonly number[];
  /** The windows those citations name. */
  readonly windows: readonly CitedWindow[];
}

/** An answer the dashboard marks, and the version it was given about. */
export interface OpenAnswer {
  /** The version asked about. */
  readonly version: number;
  /** The citations and the evidence. */
  readonly answer: Pick<Answer, 'citations' | 'evidence'>;
}

/**
 * The window of a citation, when it names a valid one.
 *
 * @param citation - The citation.
 * @returns The window, or `undefined`.
 */
function windowOf(citation: Answer['citations'][number]): CitedWindow | undefined {
  if (citation.from === undefined || citation.to === undefined) return undefined;
  const [from, to] = [Date.parse(citation.from), Date.parse(citation.to)];
  if (Number.isNaN(from) || Number.isNaN(to) || from >= to) return undefined;
  return { n: citation.n, from, to };
}

/**
 * The marks an answer puts on the panels it cites: by the citation's panel, else the panel of the
 * read it cites.
 *
 * @param answer - The citations and the evidence.
 * @returns The marks, by panel id.
 */
export function panelMarks(answer: OpenAnswer['answer']): Record<string, PanelMark> {
  const panelOfRead = new Map(answer.evidence.map((read) => [read.id, read.panelId]));
  const marks: Record<string, { numbers: number[]; windows: CitedWindow[] }> = {};
  for (const citation of answer.citations) {
    const panelId = citation.panelId ?? panelOfRead.get(citation.evidenceId ?? '');
    if (panelId !== undefined) marks[panelId] = withCitation(marks[panelId], citation);
  }
  return marks;
}

/**
 * A panel's marks with one more citation: its number once, and its window.
 *
 * @param mark - The panel's marks so far, if any.
 * @param citation - The citation.
 * @returns The marks.
 */
function withCitation(
  mark: { numbers: number[]; windows: CitedWindow[] } | undefined,
  citation: Answer['citations'][number],
) {
  const { numbers, windows } = mark ?? { numbers: [], windows: [] };
  const window = windowOf(citation);
  return {
    numbers: numbers.includes(citation.n) ? numbers : [...numbers, citation.n],
    windows: window ? [...windows, window] : windows,
  };
}

/**
 * The marks to draw for an open answer on the version shown: none when it was asked about another
 * version, whose panels may differ.
 *
 * @param open - The open answer, if any.
 * @param shownVersion - The version on screen.
 * @returns The marks, by panel id, or `undefined`.
 */
export function marksOnVersion(
  open: OpenAnswer | undefined,
  shownVersion: number,
): Record<string, PanelMark> | undefined {
  if (!open || open.version !== shownVersion) return undefined;
  return panelMarks(open.answer);
}
