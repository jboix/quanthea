/**
 * Named arrangements: rows of panels the agent asks for by name instead of grid numbers. The set
 * is closed, and the server turns each row into places on the grid, so the spec stored holds
 * plain grid numbers. Rows go from the top in the order given; panels no row names follow below,
 * as they were.
 */
import { gridColumns, type Panel } from '@quanthea/shared';
import { QueryError } from '../queries/index.ts';
import { compactGrid, heights } from './layout.ts';
import { shapeOfPanel } from './layout-map.ts';

/** The arrangements, and how many panels each puts on one row. */
const perRow = { stats: 6, 'chart-table': 2, full: 1, two: 2, three: 3 } as const;

/** An arrangement's name. */
type Arrangement = keyof typeof perRow;

/** The columns the wider panel of a chart beside a table takes. */
const chartColumns = 7;

/**
 * Whether a name is an arrangement.
 *
 * @param name - The name.
 * @returns Whether the set has it.
 */
function isArrangement(name: string | undefined): name is Arrangement {
  return name !== undefined && Object.hasOwn(perRow, name);
}

/**
 * The widths of panels that share a row, which fill it.
 *
 * @param count - How many panels.
 * @returns One width each, the first ones a column wider when the row does not divide evenly.
 */
function shares(count: number): number[] {
  const base = Math.floor(gridColumns / count);
  const wider = gridColumns - base * count;
  return Array.from({ length: count }, (_, index) => base + (index < wider ? 1 : 0));
}

/**
 * The widths of a chart beside a table: the table takes the narrower part, on either side.
 *
 * @param panels - The two panels.
 * @returns Their widths.
 */
function besideWidths(panels: readonly Panel[]): number[] {
  const tableFirst =
    panels[0] !== undefined &&
    shapeOfPanel(panels[0]) === 'table' &&
    (panels[1] === undefined || shapeOfPanel(panels[1]) !== 'table');
  const narrow = gridColumns - chartColumns;
  return tableFirst ? [narrow, chartColumns] : [chartColumns, narrow];
}

/**
 * Splits the panels of an arrangement into grid rows of even length.
 *
 * @param panels - The panels.
 * @param most - The most panels on one row.
 * @returns The rows.
 */
function chunks(panels: readonly Panel[], most: number): Panel[][] {
  const rows = Math.ceil(panels.length / most);
  const each = Math.ceil(panels.length / rows);
  return Array.from({ length: rows }, (_, row) => panels.slice(row * each, (row + 1) * each));
}

/**
 * The panel a name means: by id, else by title.
 *
 * @param panels - The panels.
 * @param name - An id or a title.
 * @returns The panel.
 * @throws {QueryError} When no panel has that id or title.
 */
function named(panels: readonly Panel[], name: string): Panel {
  const key = name.trim().toLowerCase();
  const found =
    panels.find((panel) => panel.id === name) ??
    panels.find((panel) => panel.title.trim().toLowerCase() === key);
  if (found) return found;
  const known = panels.map((panel) => panel.id).join(', ');
  throw new QueryError(`"arrange" names no panel "${name}". The panels are: ${known}.`);
}

/**
 * The arrangement a row starts with.
 *
 * @param name - The row's first entry.
 * @param count - How many panels the row names.
 * @returns The arrangement.
 * @throws {QueryError} When the set has no such arrangement, or it takes another number of panels.
 */
function arrangementOf(name: string | undefined, count: number): Arrangement {
  if (!isArrangement(name)) {
    const known = Object.keys(perRow).join(', ');
    throw new QueryError(
      `No arrangement "${name ?? ''}". A row of "arrange" starts with one of: ${known}.`,
    );
  }
  if (name === 'chart-table' && count !== 2)
    throw new QueryError('"chart-table" takes two panels.');
  if (count === 0) throw new QueryError(`"${name}" takes at least one panel.`);
  return name;
}

/**
 * Checks one row of `arrange` and finds its panels.
 *
 * @param panels - The panels of the dashboard.
 * @param row - The arrangement, then the panels' ids or titles.
 * @param taken - The ids earlier rows placed; this row's are added.
 * @returns The arrangement and its panels.
 * @throws {QueryError} When the arrangement or a panel is unknown, a panel is placed twice, or the
 *   row has the wrong number of panels.
 */
function readRow(panels: readonly Panel[], row: readonly string[], taken: Set<string>) {
  const [first, ...names] = row;
  const name = arrangementOf(first, names.length);
  const found = names.map((each) => named(panels, each));
  for (const { id } of found) {
    if (taken.has(id)) throw new QueryError(`"arrange" places "${id}" twice.`);
    taken.add(id);
  }
  return { name, panels: found };
}

/**
 * Places the grid rows of one arrangement from a grid line down.
 *
 * @param name - The arrangement.
 * @param panels - Its panels.
 * @param top - The grid line the first row starts on.
 * @returns The panels in place, and the grid line below them.
 */
function placeRows(name: Arrangement, panels: readonly Panel[], top: number) {
  let y = top;
  const placed = chunks(panels, perRow[name]).flatMap((row) => {
    const widths = name === 'chart-table' ? besideWidths(row) : shares(row.length);
    const h = Math.max(...row.map((panel) => heights[shapeOfPanel(panel)]));
    let x = 0;
    const inRow = row.map((panel, index) => {
      const w = widths[index] ?? gridColumns;
      const grid = { x, y, w, h };
      x += w;
      return { ...panel, grid };
    });
    y += h;
    return inRow;
  });
  return { placed, bottom: y };
}

/**
 * Arranges panels as the rows ask: the rows from the top, then the panels no row names, as they
 * were. Every panel placed takes the height of its kind, and a row takes its tallest.
 *
 * @param panels - The panels after the edit.
 * @param rows - The rows of `arrange`, each an arrangement then panel ids or titles.
 * @returns The panels in their order, at their new places; unchanged when no row is given.
 * @throws {QueryError} When a row cannot be placed, with what to send instead.
 */
export function arrangedPanels(
  panels: readonly Panel[],
  rows: readonly (readonly string[])[],
): Panel[] {
  if (rows.length === 0) return [...panels];
  const taken = new Set<string>();
  let y = 0;
  const arranged = rows.flatMap((row) => {
    const read = readRow(panels, row, taken);
    const { placed, bottom } = placeRows(read.name, read.panels, y);
    y = bottom;
    return placed;
  });
  const rest = panels.filter((panel) => !taken.has(panel.id));
  const top = Math.min(...rest.map((panel) => panel.grid.y));
  const below = rest.map((panel) => ({
    ...panel,
    grid: { ...panel.grid, y: y + panel.grid.y - top },
  }));
  const byId = new Map(compactGrid([...arranged, ...below]).map((panel) => [panel.id, panel]));
  return panels.map((panel) => byId.get(panel.id) ?? panel);
}
