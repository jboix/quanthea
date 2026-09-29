/**
 * Where new panels go: packed in reading order into rows below the existing panels, each as wide
 * as asked or as its kind usually is. Existing panels never move.
 */
import type { Panel } from '@querent/shared';
import type { PanelDraft, PanelShape } from './draft.ts';
import type { Width } from './request.ts';

/** Grid columns of each width. */
const columns: Readonly<Record<Width, number>> = { quarter: 3, third: 4, half: 6, full: 12 };

/** The usual width of each kind of panel. */
const usualWidth: Readonly<Record<PanelShape, Width>> = {
  stat: 'quarter',
  time: 'full',
  chart: 'half',
  table: 'half',
};

/** The height of each kind of panel, in rows of 40 px. */
const heights: Readonly<Record<PanelShape, number>> = { stat: 3, time: 8, chart: 7, table: 7 };

/** A grid position. */
type Grid = Panel['grid'];

/**
 * The size of a draft on the grid.
 *
 * @param draft - The draft.
 * @returns Its width and height.
 */
export function sizeOf(draft: PanelDraft): { w: number; h: number } {
  return { w: columns[draft.width ?? usualWidth[draft.shape]], h: heights[draft.shape] };
}

/**
 * Places drafts in rows below the existing panels.
 *
 * @param existing - The panels that stay where they are.
 * @param drafts - The new panels, in reading order.
 * @returns One grid position per draft.
 */
export function placeBelow(existing: readonly Panel[], drafts: readonly PanelDraft[]): Grid[] {
  let y = Math.max(0, ...existing.map((panel) => panel.grid.y + panel.grid.h));
  let x = 0;
  let rowHeight = 0;
  return drafts.map((draft) => {
    const { w, h } = sizeOf(draft);
    if (x + w > 12) {
      y += rowHeight;
      x = 0;
      rowHeight = 0;
    }
    const grid = { x, y, w, h };
    x += w;
    rowHeight = Math.max(rowHeight, h);
    return grid;
  });
}

/**
 * A panel id from a title, unique among the taken ones.
 *
 * @param title - The title.
 * @param taken - The ids in use; the new id is added.
 * @returns Such as `error-rate`, or `error-rate-2` when that is taken.
 */
export function panelId(title: string, taken: Set<string>): string {
  const base =
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'panel';
  let id = base;
  for (let suffix = 2; taken.has(id); suffix += 1) id = `${base}-${suffix}`;
  taken.add(id);
  return id;
}
