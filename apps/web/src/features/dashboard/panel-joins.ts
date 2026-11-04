/**
 * How the panels of a tight grid join: which edges meet another panel, and which corners are on
 * the outside of the block and stay rounded.
 */
import type { Panel } from '@quanthea/shared';

/** How one panel joins its neighbours on a tight grid. */
export interface PanelJoin {
  /** Whether a panel touches its left edge, so the two share one hairline. */
  readonly left: boolean;
  /** Whether a panel touches its top edge, so the two share one hairline. */
  readonly top: boolean;
  /** Whether each corner is on the outside of the block: top left, top right, bottom right, bottom left. */
  readonly rounded: readonly [boolean, boolean, boolean, boolean];
}

/** The grid cells panels cover. */
type Cells = ReadonlySet<string>;

/**
 * The cells the panels cover, each as `x,y`.
 *
 * @param panels - The panels.
 * @returns The covered cells.
 */
function coveredCells(panels: readonly Panel[]): Cells {
  const cells = new Set<string>();
  for (const { grid } of panels)
    for (let x = grid.x; x < grid.x + grid.w; x += 1)
      for (let y = grid.y; y < grid.y + grid.h; y += 1) cells.add(`${x},${y}`);
  return cells;
}

/**
 * Whether any cell of a run along one line is covered.
 *
 * @param cells - The covered cells.
 * @param from - The first cell.
 * @param length - How many cells.
 * @param along - Whether the run goes across (`x`) or down (`y`).
 * @returns Whether one is covered.
 */
function anyCovered(cells: Cells, from: [number, number], length: number, along: 'x' | 'y') {
  return Array.from({ length }, (_, step) =>
    along === 'x' ? `${from[0] + step},${from[1]}` : `${from[0]},${from[1] + step}`,
  ).some((cell) => cells.has(cell));
}

/**
 * Whether a corner is on the outside: neither cell beside it, across and down, is covered.
 *
 * @param cells - The covered cells.
 * @param across - The cell beside the corner across.
 * @param down - The cell beside the corner up or down.
 * @returns Whether it stays rounded.
 */
function outside(cells: Cells, across: [number, number], down: [number, number]): boolean {
  return !cells.has(`${across[0]},${across[1]}`) && !cells.has(`${down[0]},${down[1]}`);
}

/**
 * How each panel joins its neighbours on a tight grid.
 *
 * @param panels - The panels of one grid.
 * @returns The join of each panel, by id.
 */
export function panelJoins(panels: readonly Panel[]): Map<string, PanelJoin> {
  const cells = coveredCells(panels);
  return new Map(
    panels.map(({ id, grid }) => {
      const { x, y, w, h } = grid;
      const [right, bottom] = [x + w, y + h];
      const rounded = [
        outside(cells, [x - 1, y], [x, y - 1]),
        outside(cells, [right, y], [right - 1, y - 1]),
        outside(cells, [right, bottom - 1], [right - 1, bottom]),
        outside(cells, [x - 1, bottom - 1], [x, bottom]),
      ] as const;
      const left = anyCovered(cells, [x - 1, y], h, 'y');
      const top = anyCovered(cells, [x, y - 1], w, 'x');
      return [id, { left, top, rounded }];
    }),
  );
}
