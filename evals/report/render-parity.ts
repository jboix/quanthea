/**
 * The parity cases in the report: one row per family of panels, by family id. A family is green
 * when its case passes, red when it fails, and skipped when the world lacks what the case needs.
 * Two marks say whether a panel gets its data as expected (the shape) and shows it as expected
 * (the view), and a third whether the dashboard's layout reads well. A skipped family was not
 * asked, and one whose run erred says nothing of the product: neither counts as a failure.
 */
import { parityCases } from '../cases/parity.ts';
import { parityFamilies } from '../cases/parity-families.ts';
import { type CaseResult, caseStatus, reasonsOf, type TrialResult } from '../core/result.ts';
import type { Skipped } from '../core/select.ts';
import { escapeHtml } from './html.ts';
import { type LayoutMark, layoutReasons } from './layout-mark.ts';

/** The part of a run's report the parity families are read from. */
export interface ParityRun {
  /** Each case's results. */
  readonly results: readonly CaseResult[];
  /** The cases that were not run; absent when none. */
  readonly skipped?: readonly Skipped[];
}

/** Whether a part of the expected panel is there: `none` when the case checks none. */
export type Mark = 'yes' | 'no' | 'none';

/** A family's verdict. */
export type FamilyStatus = 'green' | 'red' | 'skipped' | 'error';

/** One family's row. */
export interface FamilyRow {
  /** The family's id. */
  readonly id: string;
  /** What a panel of the family is. */
  readonly what: string;
  /** Its verdict. */
  readonly status: FamilyStatus;
  /** Whether a panel gets its data as expected: the data kind, aggregations and operations. */
  readonly shape: Mark;
  /** Whether that panel shows it as expected: the view's kind, recipe and fields. */
  readonly view: Mark;
  /** Whether the layout of the dashboard reads well: `none` when none was built. */
  readonly layout: Mark;
  /** Why it is red, or what the world lacks when it is skipped. */
  readonly why: string;
}

/** How many families are green, red and skipped. */
export interface ParityTally {
  /** The families whose question passes. */
  readonly green: number;
  /** The families whose question fails. */
  readonly red: number;
  /** The families whose question was not asked. */
  readonly skipped: number;
  /** The families whose run erred, which says nothing of the product. */
  readonly errors: number;
}

/**
 * A mark read from a check of a trial: none when the case has no such check, yes when it passed.
 *
 * @param trial - The trial.
 * @param id - The check's name.
 * @returns The mark.
 */
function markOf(trial: TrialResult, id: string): Mark {
  const check = trial.checks.find((each) => each.id === id);
  if (!check) return 'none';
  return check.outcome === 'pass' ? 'yes' : 'no';
}

/**
 * The layout mark of a question that was asked, as one mark.
 *
 * @param layout - What the layout misses, if a dashboard was built.
 * @returns Yes when it misses nothing.
 */
function layoutMarkOf(layout: LayoutMark | undefined): Mark {
  if (!layout) return 'none';
  return layoutReasons(layout).length === 0 ? 'yes' : 'no';
}

/** The family status of each status a case can have. */
const statusOf = { pass: 'green', fail: 'red', review: 'red', error: 'error' } as const;

/**
 * A family's row, when its case ran: read on its first trial that says something of the product.
 *
 * @param result - The case's results.
 * @param what - What a panel of the family is.
 * @returns The row.
 */
function ranRow(result: CaseResult, what: string): FamilyRow {
  const told = result.trials.find((trial) => trial.status !== 'error') ?? result.trials[0];
  const failed = result.trials.find((trial) => trial.status !== 'pass');
  const why = failed?.evidence.error ?? (failed ? reasonsOf(failed).join('; ') : '');
  const marks = told
    ? { shape: markOf(told, 'shape-data'), view: markOf(told, 'shape-view') }
    : { shape: 'none' as const, view: 'none' as const };
  const layout = layoutMarkOf(told?.layout);
  return { id: result.id, what, status: statusOf[caseStatus(result)], ...marks, layout, why };
}

/**
 * A family's row, when its case ran or was skipped.
 *
 * @param id - The family's id, which is its case's.
 * @param what - What a panel of the family is.
 * @param run - The run.
 * @returns The row; nothing when the run left the case out.
 */
function rowOf(id: string, what: string, run: ParityRun): FamilyRow | undefined {
  const result = run.results.find((each) => each.id === id);
  if (result) return ranRow(result, what);
  const skipped = run.skipped?.find((each) => each.id === id);
  if (!skipped) return undefined;
  const why = `the world has no ${skipped.needs.join(' and no ')}`;
  return { id, what, status: 'skipped', shape: 'none', view: 'none', layout: 'none', why };
}

/**
 * The rows of the families a run asked or skipped, in the families' order.
 *
 * @param run - The run.
 * @returns The rows; none when the run has no parity question.
 */
export function familyRows(run: ParityRun): FamilyRow[] {
  return parityFamilies.flatMap((family) => {
    const parityCase = parityCases.find((each) => each.family === family.id);
    const row = parityCase ? rowOf(parityCase.id, family.what, run) : undefined;
    return row ? [row] : [];
  });
}

/**
 * Counts the families by verdict.
 *
 * @param rows - The rows.
 * @returns How many are green, red and skipped.
 */
export function tallyOf(rows: readonly FamilyRow[]): ParityTally {
  const count = (status: FamilyStatus) => rows.filter((row) => row.status === status).length;
  const errors = count('error');
  return { green: count('green'), red: count('red'), skipped: count('skipped'), errors };
}

/**
 * The parity score of a run in one line. The families asked are the green and the red ones: a
 * skipped family is named apart, and is neither.
 *
 * @param run - The run.
 * @returns Such as `Parity: 5 of 31 families green, 26 red, 2 skipped`; nothing with no family.
 */
export function parityLine(run: ParityRun): string | undefined {
  const rows = familyRows(run);
  if (rows.length === 0) return undefined;
  const { green, red, skipped, errors } = tallyOf(rows);
  const asked = green + red;
  const families = asked === 1 ? 'family' : 'families';
  const erred = errors > 0 ? `, ${errors} erred` : '';
  return `Parity: ${green} of ${asked} ${families} green, ${red} red, ${skipped} skipped${erred}`;
}

/** Each verdict and mark as the Markdown table shows it. */
const signs: Readonly<Record<FamilyStatus | Mark, string>> = {
  green: '🟢 green',
  red: '🔴 red',
  skipped: '⚪ skipped',
  error: '⚠️ error',
  yes: '✅',
  no: '❌',
  none: '',
};

/**
 * Text for a Markdown table cell: pipes escaped, lines joined.
 *
 * @param text - The text.
 * @returns The cell.
 */
function cell(text: string): string {
  return text.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

/**
 * The parity families in Markdown: the score, then a table with a row per family.
 *
 * @param run - The run.
 * @returns The lines; none when the run has no parity question.
 */
export function markdownParity(run: ParityRun): string[] {
  const rows = familyRows(run);
  const score = parityLine(run);
  if (score === undefined) return [];
  const lines = rows.map((row) => {
    const marks = [signs[row.shape], signs[row.view], signs[row.layout]];
    const cells = [row.id, signs[row.status], cell(row.what), ...marks, cell(row.why)];
    return `| ${cells.join(' | ')} |`;
  });
  return [
    `### ${score}`,
    '',
    '| Family | | A panel of it | Shape | View | Layout | Why |',
    '| --- | --- | --- | :-: | :-: | :-: | --- |',
    ...lines,
    '',
  ];
}

/**
 * A mark's cell in HTML.
 *
 * @param mark - The mark.
 * @returns The cell, empty when the question expects nothing of that part.
 */
function htmlMark(mark: Mark): string {
  return `<td class="mark" data-mark="${mark}">${mark === 'none' ? '' : mark}</td>`;
}

/**
 * A family's row in HTML.
 *
 * @param row - The row.
 * @returns The HTML.
 */
function htmlRow(row: FamilyRow): string {
  const cells = [
    `<td>${escapeHtml(row.id)}</td>`,
    `<td><span class="status">${row.status}</span></td>`,
    `<td>${escapeHtml(row.what)}</td>`,
    htmlMark(row.shape),
    htmlMark(row.view),
    htmlMark(row.layout),
    `<td class="muted">${escapeHtml(row.why)}</td>`,
  ];
  return `<tr data-status="${row.status}">${cells.join('')}</tr>`;
}

/**
 * The parity families in HTML: the score, then a table with a row per family.
 *
 * @param run - The run.
 * @returns The HTML; empty when the run has no parity question.
 */
export function htmlParity(run: ParityRun): string {
  const score = parityLine(run);
  if (score === undefined) return '';
  const head = ['Family', '', 'A panel of it', 'Shape', 'View', 'Layout', 'Why']
    .map((title) => `<th>${title}</th>`)
    .join('');
  return `<section class="parity">
<h2>${escapeHtml(score)}</h2>
<table><thead><tr>${head}</tr></thead>
<tbody>${familyRows(run).map(htmlRow).join('\n')}</tbody></table>
</section>`;
}
