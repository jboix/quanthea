/**
 * Keeps panels from overlapping on the 12-column grid. Overlaps are repaired, not refused: a panel
 * that overlaps an earlier one moves down until it fits.
 */
import type { Panel } from '@querent/shared';

/** A panel's place on the grid. */
type Place = Panel['grid'];

/**
 * Whether two places share a cell.
 *
 * @param first - One place.
 * @param second - The other.
 * @returns Whether they overlap.
 */
function overlaps(first: Place, second: Place): boolean {
  const apartX = first.x + first.w <= second.x || second.x + second.w <= first.x;
  const apartY = first.y + first.h <= second.y || second.y + second.h <= first.y;
  return !(apartX || apartY);
}

/**
 * Moves each panel down until it overlaps none placed before it. Panels are placed in reading
 * order (top to bottom, then left to right), so the layout keeps its shape.
 *
 * @param panels - The panels.
 * @returns The panels in their original order, with repaired places.
 */
export function packGrid(panels: readonly Panel[]): Panel[] {
  const order = panels
    .map((panel, index) => ({ panel, index }))
    .sort((a, b) => a.panel.grid.y - b.panel.grid.y || a.panel.grid.x - b.panel.grid.x);
  const placed: Place[] = [];
  const result = [...panels];
  for (const { panel, index } of order) {
    const place = { ...panel.grid };
    while (placed.some((other) => overlaps(place, other))) place.y += 1;
    placed.push(place);
    result[index] = { ...panel, grid: place };
  }
  return result;
}
