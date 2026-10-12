/**
 * The parity questions in the report: one row per family of panels, by family id. A family is
 * green when its question passes, red when it fails, and skipped when the world lacks what the
 * question needs. Two marks say whether a panel gets its data as expected (the shape) and shows it
 * as expected (the view). A skipped family was not asked, so it never counts as a failure.
 */
import { escapeHtml } from './html.ts';
import { type ParityCase, parityCases } from './parity-cases.ts';
import { parityFamilies } from './parity-families.ts';
import type { Skipped } from './parity-score.ts';
import type { ShapeExpectation } from './questions.ts';
import type { Outcome, Score } from './score.ts';
import { closestFaults } from './shape.ts';

/** One scored outcome, as much of it as a family's row reads. */
interface Scored {
  /** What happened, with the id of its question. */
  readonly outcome: { readonly id: string };
  /** How it scored. */
  readonly score: Score;
}

/** The part of a run's report the parity families are read from. */
export interface ParityRun {
  /** Each question's result. */
  readonly results: readonly Scored[];
  /** The parity questions that were not asked; absent when none. */
  readonly skipped?: readonly Skipped[];
}

/** Whether a part of the expected panel is there: `none` when the question expects none. */
export type Mark = 'yes' | 'no' | 'none';

/** A family's verdict. */
export type FamilyStatus = 'green' | 'red' | 'skipped';

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
}

/**
 * Whether a shape expects anything of a panel's data.
 *
 * @param shape - The shape expected.
 * @returns True when it names a data kind, an aggregation or an operation.
 */
function expectsData(shape: ShapeExpectation): boolean {
  const { builder, aggregations = [], operations = [] } = shape;
  return builder !== undefined || aggregations.length + operations.length > 0;
}

/**
 * A mark: whether a part that is expected misses nothing.
 *
 * @param expected - Whether the question expects the part.
 * @param faults - What the closest panel misses of it, or nothing when no panel was built.
 * @returns The mark.
 */
function markOf(expected: boolean, faults: readonly string[] | undefined): Mark {
  if (!expected) return 'none';
  return faults?.length === 0 ? 'yes' : 'no';
}

/**
 * The shape and view marks of a question that was asked, read on the panel closest to its shape.
 *
 * @param parityCase - The question.
 * @param outcome - What was built for it.
 * @returns The two marks.
 */
function marksOf(parityCase: ParityCase, outcome: object): Pick<FamilyRow, 'shape' | 'view'> {
  const shape = parityCase.expect.shape ?? {};
  const panels = 'panels' in outcome ? (outcome as Outcome).panels : [];
  const closest = closestFaults(panels, shape);
  return {
    shape: markOf(expectsData(shape), closest?.data),
    view: markOf(shape.view !== undefined, closest?.view),
  };
}

/**
 * A family's row, when its question was asked or skipped.
 *
 * @param parityCase - The family's question.
 * @param what - What a panel of the family is.
 * @param run - The run.
 * @returns The row; nothing when the run left the question out.
 */
function rowOf(parityCase: ParityCase, what: string, run: ParityRun): FamilyRow | undefined {
  const { id } = parityCase;
  const result = run.results.find((each) => each.outcome.id === id);
  if (result) {
    const status = result.score.pass ? 'green' : 'red';
    const why = result.score.reasons.join('; ');
    return { id, what, status, ...marksOf(parityCase, result.outcome), why };
  }
  const skipped = run.skipped?.find((each) => each.id === id);
  if (!skipped) return undefined;
  const why = `the world has no ${skipped.needs.join(' and no ')}`;
  return { id, what, status: 'skipped', shape: 'none', view: 'none', why };
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
    const row = parityCase ? rowOf(parityCase, family.what, run) : undefined;
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
  return { green: count('green'), red: count('red'), skipped: count('skipped') };
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
  const { green, red, skipped } = tallyOf(rows);
  const asked = green + red;
  const families = asked === 1 ? 'family' : 'families';
  return `Parity: ${green} of ${asked} ${families} green, ${red} red, ${skipped} skipped`;
}

/** Each verdict and mark as the Markdown table shows it. */
const signs: Readonly<Record<FamilyStatus | Mark, string>> = {
  green: '🟢 green',
  red: '🔴 red',
  skipped: '⚪ skipped',
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
    const cells = [row.id, signs[row.status], cell(row.what), signs[row.shape], signs[row.view]];
    return `| ${cells.join(' | ')} | ${cell(row.why)} |`;
  });
  return [
    `### ${score}`,
    '',
    '| Family | | A panel of it | Shape | View | Why |',
    '| --- | --- | --- | :-: | :-: | --- |',
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
  const head = ['Family', '', 'A panel of it', 'Shape', 'View', 'Why']
    .map((title) => `<th>${title}</th>`)
    .join('');
  return `<section class="parity">
<h2>${escapeHtml(score)}</h2>
<table><thead><tr>${head}</tr></thead>
<tbody>${familyRows(run).map(htmlRow).join('\n')}</tbody></table>
</section>`;
}
