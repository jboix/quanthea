/**
 * A dashboard's layout: where each panel of one version sits, how big it is, and whether it is
 * hidden. A layout is presentation: it changes how a version is shown, never its spec.
 */
import { z } from 'zod';
import { type DashboardSpec, type Panel, panelGridSchema } from './dashboard.ts';
import { slugSchema } from './names.ts';

/** A panel's place on the grid. */
export type PanelGrid = Panel['grid'];

/** Validates one panel's entry in a layout. */
const layoutPanelSchema = z.strictObject({
  id: slugSchema,
  grid: panelGridSchema,
  hidden: z.boolean(),
});

/** Validates a layout: one entry per panel of the version. */
export const dashboardLayoutSchema = z.strictObject({
  panels: z.array(layoutPanelSchema).max(60),
});

/** A layout. */
export type DashboardLayout = z.infer<typeof dashboardLayoutSchema>;

/** One panel's entry in a layout. */
export type LayoutPanel = DashboardLayout['panels'][number];

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
 * Moves each item down until it overlaps none placed before it. Items are placed in reading order
 * (top to bottom, then left to right), so the layout keeps its shape.
 *
 * @param items - The items, each with its place.
 * @returns The items in their original order, with repaired places.
 */
export function packGrid<Item extends { readonly grid: PanelGrid }>(
  items: readonly Item[],
): Item[] {
  const order = items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.grid.y - b.item.grid.y || a.item.grid.x - b.item.grid.x);
  const placed: PanelGrid[] = [];
  const result = [...items];
  for (const { item, index } of order) {
    const place = { ...item.grid };
    while (placed.some((other) => overlaps(place, other))) place.y += 1;
    placed.push(place);
    result[index] = { ...item, grid: place };
  }
  return result;
}

/**
 * The layout a spec has before anyone arranges it: every panel at its spec place, shown.
 *
 * @param spec - The spec.
 * @returns The layout.
 */
export function specLayout(spec: DashboardSpec): DashboardLayout {
  return {
    panels: spec.panels.map((panel) => ({ id: panel.id, grid: panel.grid, hidden: false })),
  };
}

/**
 * Places the shown panels of a layout so none overlaps another. Hidden panels take no space and
 * keep the place they had, to come back to.
 *
 * @param layout - The layout.
 * @returns The layout with its shown panels packed.
 */
export function packLayout(layout: DashboardLayout): DashboardLayout {
  const shown = packGrid(layout.panels.filter((panel) => !panel.hidden));
  const placed = new Map(shown.map((panel) => [panel.id, panel]));
  return { panels: layout.panels.map((panel) => placed.get(panel.id) ?? panel) };
}

/** A spec as a layout shows it. */
export interface LaidOutSpec {
  /** The spec with the shown panels only, at the layout's places. */
  readonly spec: DashboardSpec;
  /** The ids of the panels the layout hides. */
  readonly hidden: readonly string[];
}

/**
 * Shows a spec through a layout: shown panels at the layout's places, hidden ones left out. A
 * panel the layout does not name keeps its spec place; an entry naming no panel is ignored.
 *
 * @param spec - The spec.
 * @param layout - The layout, or `undefined` for the spec's own.
 * @returns The spec as shown, and the hidden panels' ids.
 */
export function applyLayout(spec: DashboardSpec, layout: DashboardLayout | undefined): LaidOutSpec {
  if (!layout) return { spec, hidden: [] };
  const entries = new Map(layout.panels.map((panel) => [panel.id, panel]));
  const hidden = spec.panels.filter((panel) => entries.get(panel.id)?.hidden === true);
  const shown = spec.panels
    .filter((panel) => entries.get(panel.id)?.hidden !== true)
    .map((panel) => ({ ...panel, grid: entries.get(panel.id)?.grid ?? panel.grid }));
  return {
    spec: { ...spec, panels: packGrid(shown) },
    hidden: hidden.map((panel) => panel.id),
  };
}

/**
 * Why a layout does not fit a spec, if it does not: it names every panel of the spec once, and
 * no other, and shows at least one.
 *
 * @param spec - The spec of the version the layout is for.
 * @param layout - The layout.
 * @returns The problems, empty when it fits.
 */
export function layoutProblems(spec: DashboardSpec, layout: DashboardLayout): string[] {
  const ids = layout.panels.map((panel) => panel.id);
  const known = new Set(spec.panels.map((panel) => panel.id));
  const problems: string[] = [];
  const repeated = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (repeated.length > 0)
    problems.push(`Panels named twice: ${[...new Set(repeated)].join(', ')}.`);
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length > 0) problems.push(`No such panels: ${unknown.join(', ')}.`);
  const missing = [...known].filter((id) => !ids.includes(id));
  if (missing.length > 0) problems.push(`Panels left out: ${missing.join(', ')}.`);
  if (layout.panels.every((panel) => panel.hidden)) problems.push('Show at least one panel.');
  return problems;
}
