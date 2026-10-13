/**
 * The layout mark: whether the saved spec of a dashboard or a report reads well where its panels
 * sit. It has three parts: no row leaves columns empty, the first row answers the question, and
 * related panels sit side by side. Pure, like the rest of the scoring, and read with the server's
 * own layout rows, so the mark and the advice the agent gets agree on what a gap is.
 */
import {
  columnsText,
  layoutRows,
  shapeOfPanel,
} from '@quanthea/server/src/dashboards/panels/layout-map.ts';
import type { Panel } from '@quanthea/shared';
import type { ReportCaseOutcome } from './report-score.ts';
import type { BuiltPanel, Outcome } from './score.ts';

/** A layout's mark: what each part misses. A part holds when it misses nothing. */
export interface LayoutMark {
  /** The rows that leave columns empty. */
  readonly gaps: readonly string[];
  /** Why the first row does not answer the question. */
  readonly firstRow: readonly string[];
  /** The related panels that are apart; absent when no two panels are related. */
  readonly beside?: readonly string[];
}

/** A layout to mark. */
export interface Laid {
  /** The panels of the saved spec, each with its place. */
  readonly panels: readonly Panel[];
  /** A report's headline numbers, by panel id: they have a row of their own, above the grid. */
  readonly headlines?: readonly string[];
  /** What was asked: each pattern matches a panel's title or query. None asks for no topic. */
  readonly topics?: readonly RegExp[];
}

/** The fewest panels of a dashboard that needs a headline number: fewer are the answer themselves. */
const fewestForHeadline = 3;

/**
 * Whether a panel shows one number.
 *
 * @param panel - The panel.
 * @returns True for a stat, and for a chart drawn as one.
 */
function isNumber(panel: Panel): boolean {
  return shapeOfPanel(panel) === 'stat';
}

/**
 * Panel ids, quoted, for a reason.
 *
 * @param panels - The panels.
 * @returns Such as `"orders", "revenue"`.
 */
function names(panels: readonly Panel[]): string {
  return panels.map((panel) => `"${panel.id}"`).join(', ');
}

/**
 * The rows that leave columns empty.
 *
 * @param canvas - The panels on the grid.
 * @returns One reason per row with a gap.
 */
function gapFaults(canvas: readonly Panel[]): string[] {
  return layoutRows(canvas).flatMap((row) => {
    if (row.gaps.length === 0) return [];
    const empty = row.gaps.map(([first, last]) => columnsText(first, last)).join(' and ');
    return [`row y${row.y} leaves columns ${empty} empty`];
  });
}

/**
 * Whether a row shows something of what was asked.
 *
 * @param row - The panels of the row.
 * @param topics - What was asked.
 * @returns True when a panel's title or query matches a topic, or nothing was asked.
 */
function shows(row: readonly Panel[], topics: readonly RegExp[]): boolean {
  if (topics.length === 0) return true;
  const texts = row.map((panel) => `${panel.title}\n${JSON.stringify(panel.queries)}`);
  return topics.some((topic) => texts.some((text) => topic.test(text)));
}

/**
 * Why the first row of a dashboard does not answer the question. It must hold a number when the
 * dashboard has numbers or three panels or more, and show something of what was asked.
 *
 * @param panels - The dashboard's panels.
 * @param topics - What was asked.
 * @returns The reasons.
 */
function dashboardFirstRow(panels: readonly Panel[], topics: readonly RegExp[]): string[] {
  const first = layoutRows(panels)[0]?.panels ?? [];
  const numbers = panels.filter(isNumber);
  const reasons: string[] = [];
  if (!first.some(isNumber) && numbers.length > 0)
    reasons.push(`the first row has no number: ${names(numbers)} sit below`);
  else if (numbers.length === 0 && panels.length >= fewestForHeadline)
    reasons.push('no headline number on the first row');
  if (!shows(first, topics)) reasons.push('the first row shows none of what was asked');
  return reasons;
}

/**
 * Why the headline row of a report does not answer the question. It must hold a number, every
 * number of the report, and something of what was asked.
 *
 * @param panels - The report's panels.
 * @param headlines - The headline numbers, by panel id.
 * @param topics - What was asked.
 * @returns The reasons.
 */
function reportFirstRow(
  panels: readonly Panel[],
  headlines: readonly string[],
  topics: readonly RegExp[],
): string[] {
  const leading = panels.filter((panel) => headlines.includes(panel.id));
  if (leading.length === 0) return ['no headline numbers lead the report'];
  const stray = panels
    .filter((panel) => !headlines.includes(panel.id) && isNumber(panel))
    .map((panel) => `"${panel.id}" is a number outside the headline row`);
  const asked = shows(leading, topics) ? [] : ['the headline row shows none of what was asked'];
  return [...stray, ...asked];
}

/**
 * Whether two panels sit side by side: they share a grid line.
 *
 * @param one - A panel.
 * @param other - Another.
 * @returns True when their rows overlap.
 */
function sideBySide(one: Panel, other: Panel): boolean {
  return one.grid.y < other.grid.y + other.grid.h && other.grid.y < one.grid.y + one.grid.h;
}

/**
 * The numbers that have a row to themselves while the grid has other numbers. Numbers are
 * related: they share a row, or each sits beside the chart it sums up.
 *
 * @param canvas - The panels on the grid.
 * @returns The reasons; nothing when the grid has fewer than two numbers.
 */
function lonelyNumbers(canvas: readonly Panel[]): string[] | undefined {
  const numbers = canvas.filter(isNumber);
  if (numbers.length < 2) return undefined;
  return numbers
    .filter((number) => !canvas.some((other) => other !== number && sideBySide(number, other)))
    .map((number) => `"${number.id}" is a number alone on its row`);
}

/**
 * What a panel reads, apart from the names of its queries.
 *
 * @param panel - The panel.
 * @returns A key: equal for two panels that run the same queries.
 */
function dataKey(panel: Panel): string {
  return JSON.stringify(panel.queries.map(({ refId: _refId, ...query }) => query));
}

/**
 * The pairs of panels that show the same data two ways, such as a chart and a table of one
 * query, and sit on different rows. A number and its trend are not such a pair: numbers go first.
 *
 * @param canvas - The panels on the grid.
 * @returns The reasons; nothing when no two panels show the same data.
 */
function splitPairs(canvas: readonly Panel[]): string[] | undefined {
  const others = canvas.filter((panel) => !isNumber(panel));
  const pairs = others.flatMap((one, index) =>
    others
      .slice(index + 1)
      .filter((other) => dataKey(other) === dataKey(one))
      .map((other) => [one, other] as const),
  );
  if (pairs.length === 0) return undefined;
  return pairs
    .filter(([one, other]) => !sideBySide(one, other))
    .map(([one, other]) => `"${one.id}" and "${other.id}" show the same data on different rows`);
}

/**
 * The related panels that are apart.
 *
 * @param canvas - The panels on the grid.
 * @returns The field to spread: the reasons, or nothing when no two panels are related.
 */
function besideField(canvas: readonly Panel[]): Pick<LayoutMark, 'beside'> {
  const numbers = lonelyNumbers(canvas);
  const pairs = splitPairs(canvas);
  if (numbers === undefined && pairs === undefined) return {};
  return { beside: [...(numbers ?? []), ...(pairs ?? [])] };
}

/**
 * Marks a layout.
 *
 * @param laid - The panels with their places, a report's headline numbers, and what was asked.
 * @returns The mark; nothing when there is no panel.
 */
export function layoutMark(laid: Laid): LayoutMark | undefined {
  const { panels, headlines, topics = [] } = laid;
  if (panels.length === 0) return undefined;
  const canvas = panels.filter((panel) => !headlines?.includes(panel.id));
  const firstRow = headlines
    ? reportFirstRow(panels, headlines, topics)
    : dashboardFirstRow(panels, topics);
  return { gaps: gapFaults(canvas), firstRow, ...besideField(canvas) };
}

/**
 * A built panel as the spec holds it, when the outcome kept its place.
 *
 * @param panel - The panel, as the scoring reads it.
 * @returns The panel; none for an outcome written before places were kept.
 */
function placed(panel: BuiltPanel): Panel[] {
  const { id, title, grid, view, queries } = panel;
  if (!grid || !view || !queries) return [];
  return [{ id, title, grid, view, queries: [...queries] }];
}

/**
 * Marks the layout of the dashboard a question built.
 *
 * @param outcome - What was built.
 * @param topics - What the question asks for.
 * @returns The mark; nothing when no dashboard was built, or its panels' places were not kept.
 */
export function dashboardLayout(
  outcome: Outcome,
  topics: readonly RegExp[],
): LayoutMark | undefined {
  if (outcome.error !== undefined || !outcome.built) return undefined;
  const panels = outcome.panels.flatMap(placed);
  if (panels.length < outcome.panels.length) return undefined;
  return layoutMark({ panels, topics });
}

/**
 * Marks the layout of the report a case saved.
 *
 * @param outcome - What was saved.
 * @param topics - What the headline numbers must show.
 * @returns The mark; nothing when no report was saved.
 */
export function reportLayout(
  outcome: ReportCaseOutcome,
  topics: readonly RegExp[],
): LayoutMark | undefined {
  if (outcome.error !== undefined || !outcome.spec) return undefined;
  const { panels, summaryPanels } = outcome.spec;
  return layoutMark({ panels, headlines: summaryPanels, topics });
}

/** One part of a mark, to show. */
export interface LayoutPart {
  /** Its name, such as `no gaps`. */
  readonly label: string;
  /** Whether it holds. */
  readonly holds: boolean;
}

/**
 * The parts of a mark that were judged, in order.
 *
 * @param mark - The mark.
 * @returns No gaps, the first row, and side by side when two panels are related.
 */
export function layoutParts(mark: LayoutMark): LayoutPart[] {
  const beside = mark.beside ? [{ label: 'side by side', holds: mark.beside.length === 0 }] : [];
  return [
    { label: 'no gaps', holds: mark.gaps.length === 0 },
    { label: 'first row', holds: mark.firstRow.length === 0 },
    ...beside,
  ];
}

/**
 * Everything a mark misses.
 *
 * @param mark - The mark.
 * @returns The reasons of every part; none when the layout reads well.
 */
export function layoutReasons(mark: LayoutMark): string[] {
  return [...mark.gaps, ...mark.firstRow, ...(mark.beside ?? [])];
}
