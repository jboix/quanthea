/**
 * The layout check: what reads badly in an arrangement, each with the repair, and the map it is
 * read from. It gives advice with a saved version and never refuses one, so an arrangement someone
 * made by hand, or a version stored before the check existed, always saves.
 */
import { gridColumns, type Panel } from '@quanthea/shared';
import { columnsText, layoutMap, layoutRows, shapeOfPanel } from './layout-map.ts';

/** What the agent reads of a layout after a write. */
export interface LayoutReport {
  /** The map: one line per row of the grid, top to bottom. */
  readonly rows: readonly string[];
  /** What reads badly and how to repair it; left out when nothing does. */
  readonly advice?: readonly string[];
}

/** What a layout report is made for. */
interface LayoutReportOptions {
  /** A report's headline numbers, by panel id: they have a row of their own, off the grid. */
  readonly headlines?: readonly string[];
  /** Whether to give advice; the map alone when false. */
  readonly advise?: boolean;
  /** The panels someone hid by hand, by id: the map marks them. */
  readonly hidden?: readonly string[];
}

/** The widest a number reads well: half the grid. */
const widestStat = 6;

/** The grid columns a table needs for each column it shows, and the most "two" gives a panel. */
const tableWidths = { perField: 1, half: gridColumns / 2 } as const;

/** The fewest rows a chart with a legend needs. */
const shortestWithLegend = 5;

/** The most lines of advice one write returns. */
const mostAdvice = 8;

/**
 * Whether a chart draws a legend.
 *
 * @param panel - The panel.
 * @returns Whether its option has a legend that is not turned off.
 */
function hasLegend(panel: Panel): boolean {
  if (panel.view.kind !== 'chart') return false;
  const { legend } = panel.view.option;
  if (typeof legend !== 'object' || legend === null) return false;
  return Array.isArray(legend) || legend.show !== false;
}

/**
 * A table too narrow for its columns, if it is. A table needs a grid column for each column it
 * shows, so "chart-table" suits one of up to five columns and "two" one of up to six. The repair
 * named is always wide enough, and a table on a whole row has all there is.
 *
 * @param panel - The panel.
 * @returns The advice, none for another kind or a table wide enough.
 */
function tableAdvice(panel: Panel): string[] {
  if (panel.view.kind !== 'table') return [];
  const fields = panel.view.columns.length;
  const needed = Math.min(gridColumns, fields * tableWidths.perField);
  if (panel.grid.w >= needed) return [];
  const repair =
    needed > tableWidths.half
      ? 'give it the whole row, with "full"'
      : `give it at least ${needed}, with "two" or "full"`;
  return [
    `"${panel.id}" is a table of ${fields} columns in ${panel.grid.w} grid columns: ${repair}.`,
  ];
}

/**
 * What is wrong with the size of one panel, if anything. A number alone on the grid may take a
 * whole row: it has no other number to share one with.
 *
 * @param panel - The panel.
 * @param numbers - How many numbers the grid has.
 * @returns The advice, none when its size fits what it shows.
 */
function sizeAdvice(panel: Panel, numbers: number): string[] {
  const { id, grid } = panel;
  if (numbers > 1 && shapeOfPanel(panel) === 'stat' && grid.w > widestStat)
    return [
      `"${id}" is a number ${grid.w} columns wide, more than it needs: put it in a "stats" row with the other numbers, or beside a chart.`,
    ];
  if (hasLegend(panel) && grid.h < shortestWithLegend)
    return [
      `"${id}" is a chart ${grid.h} rows tall, too short for its legend: arrange it again and it takes its usual height.`,
    ];
  return tableAdvice(panel);
}

/**
 * The rows that leave columns empty.
 *
 * @param panels - The panels on the grid.
 * @returns One line of advice per row with a gap.
 */
function gapAdvice(panels: readonly Panel[]): string[] {
  return layoutRows(panels).flatMap((row) => {
    if (row.gaps.length === 0) return [];
    const empty = row.gaps.map(([first, last]) => columnsText(first, last)).join(' and ');
    return [`Row y${row.y} leaves columns ${empty} empty: arrange its panels to fill the row.`];
  });
}

/**
 * The numbers of a dashboard that sit below a chart or a table.
 *
 * @param panels - The panels on the grid.
 * @returns The advice, none when the numbers come first.
 */
function numbersFirstAdvice(panels: readonly Panel[]): string[] {
  const others = panels.filter((panel) => shapeOfPanel(panel) !== 'stat');
  const firstOther = Math.min(...others.map((panel) => panel.grid.y));
  const below = panels.filter(
    (panel) => shapeOfPanel(panel) === 'stat' && panel.grid.y > firstOther,
  );
  if (below.length === 0) return [];
  const names = below.map((panel) => `"${panel.id}"`).join(', ');
  return [
    `The numbers ${names} sit below a chart or a table: put the numbers first, in a "stats" row.`,
  ];
}

/**
 * The numbers of a report that are not headline numbers, so they do not lead it.
 *
 * @param canvas - The report's panels on the grid: every panel that is not a headline.
 * @returns One line of advice per number.
 */
function headlineAdvice(canvas: readonly Panel[]): string[] {
  return canvas
    .filter((panel) => panel.view.kind === 'stat')
    .map(
      ({ id }) =>
        `"${id}" is a number outside the headline row: name it in "summaryPanels" and it leads the report.`,
    );
}

/**
 * The panels a map draws: all of a dashboard's, or a report's without its headline numbers, moved
 * up so the first row starts at the top.
 *
 * @param panels - The panels.
 * @param headlines - The headline numbers, for a report.
 * @returns The panels on the grid.
 */
function canvasOf(panels: readonly Panel[], headlines: readonly string[] | undefined): Panel[] {
  if (!headlines) return [...panels];
  const canvas = panels.filter((panel) => !headlines.includes(panel.id));
  const top = Math.min(...canvas.map((panel) => panel.grid.y));
  return canvas.map((panel) => ({ ...panel, grid: { ...panel.grid, y: panel.grid.y - top } }));
}

/**
 * What reads badly in a layout, each line with its repair.
 *
 * @param canvas - The panels on the grid.
 * @param report - Whether they are a report's, whose numbers lead from the headline row.
 * @returns The advice, the first rows' first, at most eight lines.
 */
function adviceFor(canvas: readonly Panel[], report: boolean): string[] {
  const first = report ? headlineAdvice(canvas) : numbersFirstAdvice(canvas);
  const numbers = canvas.filter((panel) => shapeOfPanel(panel) === 'stat').length;
  const sizes = canvas.flatMap((panel) => sizeAdvice(panel, numbers));
  return [...first, ...gapAdvice(canvas), ...sizes].slice(0, mostAdvice);
}

/**
 * The layout of a spec as the agent reads it after a write: the map, and advice on what reads
 * badly. It is made from the panels' ids, kinds and places only.
 *
 * @param panels - The spec's panels.
 * @param options - A report's headline numbers, whether to give advice, and the hidden panels.
 * @returns The map and the advice.
 */
export function layoutReport(
  panels: readonly Panel[],
  options: LayoutReportOptions = {},
): LayoutReport {
  const { headlines, advise = true, hidden } = options;
  const canvas = canvasOf(panels, headlines);
  const leading = headlines?.length ? [`headline numbers: ${headlines.join(' | ')}`] : [];
  const rows = [...leading, ...layoutMap(canvas, hidden)];
  const advice = advise ? adviceFor(canvas, headlines !== undefined) : [];
  return advice.length > 0 ? { rows, advice } : { rows };
}
