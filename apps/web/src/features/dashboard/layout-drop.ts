/**
 * Where a dragged panel lands when the pointer leaves its section: the section under the pointer,
 * named by `data-drop-section` on its element, and the cell of its grid, marked `data-drop-grid`.
 */
import { gridColumns } from '@quanthea/shared';

/** The attribute value of the panels of no section. */
export const looseSection = '';

/** A section under the pointer. */
export interface DropTarget {
  /** The section, or `undefined` for the panels of none. */
  readonly section: string | undefined;
  /** Its grid, when it has panels drawn; none while it is empty or folded. */
  readonly grid: Element | null;
}

/**
 * The section under a point, if it is not the one the drag started in.
 *
 * @param x - The pointer's horizontal position in the viewport.
 * @param y - The pointer's vertical position in the viewport.
 * @param from - The section the drag started in.
 * @returns The other section, or `undefined` over the same one or over none.
 */
export function dropTargetAt(x: number, y: number, from: string | undefined) {
  const element = document
    .elementsFromPoint(x, y)
    .find(
      (each): each is HTMLElement => each instanceof HTMLElement && 'dropSection' in each.dataset,
    );
  if (!element) return undefined;
  const key = element.dataset.dropSection;
  const section = key === looseSection ? undefined : key;
  if (section === from) return undefined;
  return { section, grid: element.querySelector('[data-drop-grid]') } satisfies DropTarget;
}

/** The grid's row height and gap, in pixels, as `panels.module.css` sets them. */
const spacing = { rowHeight: 40, gap: 16 };

/**
 * The cell a panel's top left corner lands on, in a section's grid.
 *
 * @param grid - The grid's element.
 * @param corner - Where the panel's top left corner is, in the viewport.
 * @param corner.x - Its horizontal position.
 * @param corner.y - Its vertical position.
 * @returns The column and the row.
 */
export function dropCell(grid: Element, corner: { readonly x: number; readonly y: number }) {
  const box = grid.getBoundingClientRect();
  const column = (box.width - spacing.gap * (gridColumns - 1)) / gridColumns;
  return {
    x: Math.max(0, Math.round((corner.x - box.left) / (column + spacing.gap))),
    y: Math.max(0, Math.round((corner.y - box.top) / (spacing.rowHeight + spacing.gap))),
  };
}
