/**
 * Arranging a dashboard or a report by hand, as pure functions over a layout: move and resize a panel on the
 * 12-column grid, the others making room and rising into the gaps.
 */
import {
  type Arranged,
  type DashboardLayout,
  gridColumns,
  type LayoutPanel,
  type PanelGrid,
  specLayout,
} from '@quanthea/shared';

/** The smallest a panel may be, in columns and rows. */
const minimum = { w: 2, h: 2 };

/** The tallest a panel may be, in rows, as the spec allows. */
const maxRows = 40;

/** The size of the grid on screen, in pixels, to turn a drag into cells. */
export interface GridMetrics {
  /** The width of one column. */
  readonly columnWidth: number;
  /** The height of one row. */
  readonly rowHeight: number;
  /** The gap between columns and between rows. */
  readonly gap: number;
}

/**
 * Whether two places share a cell.
 *
 * @param first - One place.
 * @param second - The other.
 * @returns Whether they overlap.
 */
function overlaps(first: PanelGrid, second: PanelGrid): boolean {
  const apartX = first.x + first.w <= second.x || second.x + second.w <= first.x;
  const apartY = first.y + first.h <= second.y || second.y + second.h <= first.y;
  return !(apartX || apartY);
}

/**
 * Settles the shown panels: one held panel stays where it is, and every other one, in reading
 * order or the order given, moves down out of the way of those placed before it, then rises until
 * it meets one. A panel never jumps over another. Hidden panels keep their place, to come back to.
 *
 * @param layout - The layout.
 * @param heldId - The panel being moved or resized, which keeps its place; none to settle all.
 * @param order - The shown panels in the order they are placed, with the places they start from;
 *   reading order when not given.
 * @returns The settled layout.
 */
export function settle(
  layout: DashboardLayout,
  heldId?: string,
  order?: readonly LayoutPanel[],
): DashboardLayout {
  const held = layout.panels.find((panel) => panel.id === heldId && !panel.hidden);
  const placed: PanelGrid[] = held ? [held.grid] : [];
  const others =
    order ??
    layout.panels
      .filter((panel) => !panel.hidden && panel !== held)
      .sort((a, b) => a.grid.y - b.grid.y || a.grid.x - b.grid.x);
  const settled = new Map<string, PanelGrid>();
  for (const panel of others) {
    const grid = risen(panel.grid, placed);
    placed.push(grid);
    settled.set(panel.id, grid);
  }
  return {
    panels: layout.panels.map((panel) => {
      const grid = settled.get(panel.id);
      return grid ? { ...panel, grid } : panel;
    }),
  };
}

/**
 * Where a panel goes among those placed before it: down out of their way, then up until it meets
 * one, so it never jumps over another.
 *
 * @param start - Where it is.
 * @param placed - The places taken.
 * @returns Its place.
 */
function risen(start: PanelGrid, placed: readonly PanelGrid[]): PanelGrid {
  const grid = { ...start };
  const free = (y: number) => !placed.some((other) => overlaps({ ...grid, y }, other));
  while (!free(grid.y)) grid.y += 1;
  while (grid.y > 0 && free(grid.y - 1)) grid.y -= 1;
  return grid;
}

/**
 * Whether a dragged panel goes before another in reading order: once it is past the other's
 * middle, moving down by its foot and moving up by its top.
 *
 * @param grid - Where the dragged panel is.
 * @param other - The other panel's place.
 * @param down - Whether the drag goes down.
 * @returns Whether it goes first.
 */
function goesBefore(grid: PanelGrid, other: PanelGrid, down: boolean): boolean {
  const middle = other.y + other.h / 2;
  return down ? grid.y + grid.h <= middle : grid.y < middle;
}

/**
 * Places a dragged panel among the others: it takes its turn in reading order where it was
 * dragged, and every panel, it included, then rises as far as it goes. A panel dragged past the
 * middle of another changes places with it.
 *
 * @param layout - The layout.
 * @param id - The panel.
 * @param to - The column and row it was dragged to.
 * @param down - Whether it was dragged down, rather than up or across.
 * @returns The layout.
 */
export function placePanel(
  layout: DashboardLayout,
  id: string,
  to: { readonly x: number; readonly y: number },
  down: boolean,
): DashboardLayout {
  const moving = layout.panels.find((panel) => panel.id === id && !panel.hidden);
  if (!moving) return layout;
  const { w } = moving.grid;
  const x = Math.min(gridColumns - w, Math.max(0, to.x));
  const grid = { ...moving.grid, x, y: Math.max(0, to.y) };
  const others = layout.panels
    .filter((panel) => !panel.hidden && panel !== moving)
    .sort((a, b) => a.grid.y - b.grid.y || a.grid.x - b.grid.x);
  const at = others.findIndex((panel) => goesBefore(grid, panel.grid, down));
  const order = [...others];
  order.splice(at === -1 ? order.length : at, 0, { ...moving, grid });
  return settle(layout, undefined, order);
}

/**
 * Moves a panel one step with the keyboard: across by a column, or up or down to the next place it
 * can take, changing places with the panel it passes.
 *
 * @param layout - The layout.
 * @param id - The panel.
 * @param step - The column or the row to go by, each -1, 0 or 1.
 * @param step.x - Across.
 * @param step.y - Up or down.
 * @returns The layout, the same one when the panel can go no further.
 */
export function stepPanel(
  layout: DashboardLayout,
  id: string,
  step: { readonly x: number; readonly y: number },
): DashboardLayout {
  const grid = layout.panels.find((panel) => panel.id === id)?.grid;
  if (!grid) return layout;
  for (let rows = 1; rows <= maxRows; rows += 1) {
    const to = { x: grid.x + step.x, y: grid.y + step.y * rows };
    const next = placePanel(layout, id, to, step.y > 0);
    const after = next.panels.find((panel) => panel.id === id)?.grid;
    if (step.y === 0 || after?.y !== grid.y) return next;
  }
  return layout;
}

/**
 * Changes one panel's place or size, kept on the grid, and settles the others around it.
 *
 * @param layout - The layout.
 * @param id - The panel.
 * @param change - Its new place or size; missing fields stay as they are.
 * @returns The layout, the panel held where it was put.
 */
function reshape(layout: DashboardLayout, id: string, change: Partial<PanelGrid>): DashboardLayout {
  const panels = layout.panels.map((panel): LayoutPanel => {
    if (panel.id !== id) return panel;
    const merged = { ...panel.grid, ...change };
    const w = Math.min(gridColumns, Math.max(minimum.w, merged.w));
    const h = Math.min(maxRows, Math.max(minimum.h, merged.h));
    const x = Math.min(gridColumns - w, Math.max(0, merged.x));
    return { ...panel, grid: { x, y: Math.max(0, merged.y), w, h } };
  });
  return settle({ panels }, id);
}

/**
 * Resizes a panel from its top left corner.
 *
 * @param layout - The layout.
 * @param id - The panel.
 * @param size - Its width in columns and height in rows.
 * @returns The layout.
 */
export function resizePanel(
  layout: DashboardLayout,
  id: string,
  size: { readonly w: number; readonly h: number },
): DashboardLayout {
  const panel = layout.panels.find((each) => each.id === id);
  const w = panel ? Math.min(size.w, gridColumns - panel.grid.x) : size.w;
  return reshape(layout, id, { w, h: size.h });
}

/**
 * How many cells a drag of so many pixels crosses.
 *
 * @param dx - The horizontal distance, in pixels.
 * @param dy - The vertical distance, in pixels.
 * @param metrics - The grid's size on screen.
 * @returns The columns and rows, rounded to the nearest cell.
 */
export function cellsOf(
  dx: number,
  dy: number,
  metrics: GridMetrics,
): { readonly columns: number; readonly rows: number } {
  return {
    columns: Math.round(dx / (metrics.columnWidth + metrics.gap)),
    rows: Math.round(dy / (metrics.rowHeight + metrics.gap)),
  };
}

/**
 * The layout an editor starts from: the one shown, or the spec's own.
 *
 * @param spec - The version's spec.
 * @param shown - The layout it is shown with, if one was saved.
 * @returns The layout.
 */
export function startingLayout(spec: Arranged, shown: DashboardLayout | undefined) {
  return shown ?? specLayout(spec);
}

/**
 * Whether two layouts differ.
 *
 * @param first - One layout.
 * @param second - The other.
 * @returns Whether a panel moved, resized, hid or came back.
 */
export function layoutChanged(first: DashboardLayout, second: DashboardLayout): boolean {
  return JSON.stringify(first) !== JSON.stringify(second);
}

/**
 * Hides a panel: it stays in the version, takes no space, and keeps its place to come back to.
 *
 * @param layout - The layout.
 * @param id - The panel.
 * @returns The layout, the others risen into its space.
 */
export function hidePanel(layout: DashboardLayout, id: string): DashboardLayout {
  const panels = layout.panels.map((panel) =>
    panel.id === id ? { ...panel, hidden: true } : panel,
  );
  return settle({ panels });
}

/**
 * Shows a hidden panel again, at the place it had; the others make room.
 *
 * @param layout - The layout.
 * @param id - The panel.
 * @returns The layout.
 */
export function showPanel(layout: DashboardLayout, id: string): DashboardLayout {
  const panels = layout.panels.map((panel) =>
    panel.id === id ? { ...panel, hidden: false } : panel,
  );
  return settle(settle({ panels }, id));
}

/**
 * Makes a panel span the whole width, or half of it, on its row.
 *
 * @param layout - The layout.
 * @param id - The panel.
 * @param width - Full or half.
 * @returns The layout, the panel held where it is and the others settled.
 */
export function setWidth(
  layout: DashboardLayout,
  id: string,
  width: 'full' | 'half',
): DashboardLayout {
  const panel = layout.panels.find((each) => each.id === id);
  if (!panel) return layout;
  const w = width === 'full' ? gridColumns : gridColumns / 2;
  return settle(reshape(layout, id, { x: Math.min(panel.grid.x, gridColumns - w), w }));
}
