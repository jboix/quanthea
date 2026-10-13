/**
 * The layout mark in the report: a cell of the printed table and of the Markdown table, a line of
 * a question's section in the HTML page, and the run's tally. A result with no layout to mark,
 * such as an answer case, shows nothing.
 */
import { escapeHtml } from './html.ts';
import { type LayoutMark, layoutParts, layoutReasons } from './layout-mark.ts';

/** A layout's mark, or nothing when the result has no layout to mark. */
type Marked = LayoutMark | undefined;

/**
 * The mark in the printed table.
 *
 * @param mark - The mark.
 * @returns Such as `layout 2/3`: the parts that hold of those judged; `layout -` with no mark.
 */
export function layoutCell(mark: Marked): string {
  if (!mark) return 'layout -';
  const parts = layoutParts(mark);
  return `layout ${parts.filter((part) => part.holds).length}/${parts.length}`;
}

/**
 * How many marks hold one part, of those that judged it.
 *
 * @param marks - The marks.
 * @param label - The part's name.
 * @returns Such as `no gaps 6 of 7`; nothing when no mark judged the part.
 */
function partTally(marks: readonly LayoutMark[], label: string): string[] {
  const judged = marks.flatMap((mark) => layoutParts(mark).filter((part) => part.label === label));
  if (judged.length === 0) return [];
  return [`${label} ${judged.filter((part) => part.holds).length} of ${judged.length}`];
}

/**
 * The layout score of a run in one line.
 *
 * @param marked - Each result's mark, if it has one.
 * @returns Such as `Layout: 5 of 7 read well (no gaps 6 of 7, first row 7 of 7)`; nothing when
 *   no result has a layout.
 */
export function layoutLine(marked: readonly Marked[]): string | undefined {
  const marks = marked.filter((mark) => mark !== undefined);
  if (marks.length === 0) return undefined;
  const well = marks.filter((mark) => layoutReasons(mark).length === 0).length;
  const parts = ['no gaps', 'first row', 'side by side'].flatMap((label) =>
    partTally(marks, label),
  );
  return `Layout: ${well} of ${marks.length} read well (${parts.join(', ')})`;
}

/**
 * The mark in the Markdown table.
 *
 * @param mark - The mark.
 * @returns A tick when the layout reads well, else a cross and what it misses; empty with no mark.
 */
export function markdownLayout(mark: Marked): string {
  if (!mark) return '';
  const reasons = layoutReasons(mark);
  return reasons.length === 0 ? '✅' : `❌ ${reasons.join('; ')}`;
}

/**
 * The mark in a question's section of the HTML page: each part judged, then what the layout
 * misses.
 *
 * @param mark - The mark.
 * @returns The HTML; empty with no mark.
 */
export function htmlLayout(mark: Marked): string {
  if (!mark) return '';
  const parts = layoutParts(mark)
    .map(
      (part) =>
        `<span class="mark" data-mark="${part.holds ? 'yes' : 'no'}">${part.label}: ${part.holds ? 'yes' : 'no'}</span>`,
    )
    .join(' · ');
  const reasons = layoutReasons(mark)
    .map((reason) => `<li>${escapeHtml(reason)}</li>`)
    .join('');
  const list = reasons ? `<ul class="muted">${reasons}</ul>` : '';
  return `<p class="layout">Layout: ${parts}</p>${list}`;
}
