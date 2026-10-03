/**
 * Checks an answer before anyone sees it: every marker has its citation and every citation its
 * marker, each citation points at a read that happened or a panel the dashboard has, and each
 * time window lies within the range asked about. An explanation has no reads and no windows.
 */
import type { AnswerCitation } from '@quanthea/shared';

/** What an answer's citations may point at. */
export interface AnswerScope {
  /** The dashboard's panel ids. */
  readonly panelIds: ReadonlySet<string>;
  /** The ids of the reads made while answering. */
  readonly evidenceIds: ReadonlySet<string>;
  /** The range asked about, epoch milliseconds; `undefined` for an explanation, which has none. */
  readonly range: { readonly from: number; readonly to: number } | undefined;
}

/** An answer as the model gives it. */
interface GivenAnswer {
  /** The text, with markers such as `[1]`. */
  readonly text: string;
  /** The citations. */
  readonly citations: readonly AnswerCitation[];
}

/**
 * The marker numbers in a text, such as 1 and 2 for "… [1] … [2]".
 *
 * @param text - The text.
 * @returns The numbers.
 */
function markersOf(text: string): Set<number> {
  return new Set([...text.matchAll(/\[(\d{1,3})\]/g)].map((match) => Number(match[1])));
}

/**
 * The issues of a citation's time window.
 *
 * @param citation - The citation.
 * @param range - The range asked about, if any.
 * @returns The issues; none without a window.
 */
function windowIssues(citation: AnswerCitation, range: AnswerScope['range']): string[] {
  const { n, from, to } = citation;
  if (from === undefined && to === undefined) return [];
  if (range === undefined) return [`[${n}]: an explanation has no time window; drop from and to.`];
  if (from === undefined || to === undefined) return [`[${n}]: give both from and to, or neither.`];
  return boundsIssues(n, Date.parse(from), Date.parse(to), range);
}

/**
 * The issues of a window's bounds.
 *
 * @param n - The citation's number.
 * @param start - The window's start, epoch milliseconds, or `NaN` when unreadable.
 * @param end - The window's end, likewise.
 * @param range - The range asked about.
 * @returns The issues.
 */
function boundsIssues(
  n: number,
  start: number,
  end: number,
  range: NonNullable<AnswerScope['range']>,
): string[] {
  if (Number.isNaN(start) || Number.isNaN(end))
    return [`[${n}]: from and to must be ISO 8601 times with an offset.`];
  if (start > end) return [`[${n}]: the window ends before it starts.`];
  if (start < range.from || end > range.to) {
    const asked = `${new Date(range.from).toISOString()} to ${new Date(range.to).toISOString()}`;
    return [`[${n}]: the window must lie within the range asked about, ${asked}.`];
  }
  return [];
}

/**
 * The issues of one citation's targets: a read that happened, a panel the dashboard has.
 *
 * @param citation - The citation.
 * @param scope - What citations may point at.
 * @returns The issues.
 */
function targetIssues(citation: AnswerCitation, scope: AnswerScope): string[] {
  const { n, evidenceId, panelId } = citation;
  if (evidenceId === undefined && panelId === undefined)
    return [`[${n}]: point at a read (evidenceId), a panel (panelId), or both.`];
  const issues: string[] = [];
  if (evidenceId !== undefined && !scope.evidenceIds.has(evidenceId)) {
    const known = [...scope.evidenceIds].join(', ') || 'none';
    issues.push(`[${n}]: no read has evidenceId "${evidenceId}" (reads: ${known}).`);
  }
  if (panelId !== undefined && !scope.panelIds.has(panelId)) {
    const known = [...scope.panelIds].join(', ');
    issues.push(`[${n}]: the dashboard has no panel "${panelId}" (panels: ${known}).`);
  }
  return issues;
}

/**
 * The issues of the pairing of markers and citations: one citation per marker, none without one.
 *
 * @param answer - The answer.
 * @returns The issues.
 */
function pairingIssues(answer: GivenAnswer): string[] {
  const markers = markersOf(answer.text);
  const numbers = answer.citations.map((citation) => citation.n);
  const cited = new Set(numbers);
  const repeated = numbers.filter((n, index) => numbers.indexOf(n) !== index);
  return [
    ...[...markers].filter((n) => !cited.has(n)).map((n) => `[${n}] is in the text, uncited.`),
    ...[...cited].filter((n) => !markers.has(n)).map((n) => `Citation ${n} has no [${n}].`),
    ...[...new Set(repeated)].map((n) => `Citation ${n} is given more than once.`),
  ];
}

/**
 * Checks an answer against what it may cite.
 *
 * @param answer - The text and the citations, as the model gave them.
 * @param scope - The panels, the reads and the range asked about.
 * @returns The issues, in words the model can act on; empty when the answer holds.
 */
export function answerIssues(answer: GivenAnswer, scope: AnswerScope): string[] {
  if (answer.text.trim() === '') return ['The text is empty.'];
  return [
    ...pairingIssues(answer),
    ...answer.citations.flatMap((citation) => [
      ...targetIssues(citation, scope),
      ...windowIssues(citation, scope.range),
    ]),
  ];
}
