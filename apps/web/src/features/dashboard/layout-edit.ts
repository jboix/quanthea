/**
 * Arranging a dashboard by hand, as pure functions over a layout: move and resize a panel on the
 * 12-column grid, the others making room and rising into the gaps.
 */
import {
  type DashboardLayout,
  type DashboardSpec,
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
 * order, moves down out of the way of those placed before it, then rises until it meets one. A
 * panel never jumps over another. Hidden panels keep their place, to come back to.
 *
 * @param layout - The layout.
 * @param heldId - The panel being moved or resized, which keeps its place; none to settle all.
 * @returns The settled layout.
 */
export function settle(layout: DashboardLayout, heldId?: string): DashboardLayout {
  const held = layout.panels.find((panel) => panel.id === heldId && !panel.hidden);
  const placed: PanelGrid[] = held ? [held.grid] : [];
  const others = layout.panels
    .filter((panel) => !panel.hidden && panel !== held)
    .sort((a, b) => a.grid.y - b.grid.y || a.grid.x - b.grid.x);
  const settled = new Map<string, PanelGrid>();
  for (const panel of others) {
    const grid = { ...panel.grid };
    const free = (y: number) => !placed.some((other) => overlaps({ ...grid, y }, other));
    while (!free(grid.y)) grid.y += 1;
    while (grid.y > 0 && free(grid.y - 1)) grid.y -= 1;
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
 * Moves a panel to a cell.
 *
 * @param layout - The layout.
 * @param id - The panel.
 * @param to - The column and row of its top left corner.
 * @returns The layout.
 */
export function movePanel(
  layout: DashboardLayout,
  id: string,
  to: { readonly x: number; readonly y: number },
): DashboardLayout {
  return reshape(layout, id, to);
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
export function startingLayout(spec: DashboardSpec, shown: DashboardLayout | undefined) {
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
