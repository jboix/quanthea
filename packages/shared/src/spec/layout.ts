/**
 * A layout: where each panel of one version of a dashboard or a report sits, how big it is,
 * whether it is hidden and, on a dashboard, its section. A layout is presentation: it changes how
 * a version is shown, never its spec.
 */
import type { DashboardSpec, Panel } from './dashboard.ts';
import type { DashboardLayout, PanelGrid } from './layout-schema.ts';
import { layoutSectionProblems, withLayoutSections } from './layout-sections.ts';

export {
  type DashboardLayout,
  dashboardLayoutSchema,
  type LayoutPanel,
  type LayoutSection,
  type PanelGrid,
} from './layout-schema.ts';

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
 * Packs each section's items on a grid of their own, as each section draws them: items in two
 * sections may share rows.
 *
 * @param items - The items, each with its place and its section, if any.
 * @returns The items in their original order, with repaired places.
 */
export function packSections<
  Item extends { readonly grid: PanelGrid; readonly section?: string | undefined },
>(items: readonly Item[]): Item[] {
  const placed = new Map<Item, Item>();
  for (const key of new Set(items.map((item) => item.section))) {
    const group = items.filter((item) => item.section === key);
    packGrid(group).forEach((packed, index) => {
      placed.set(group[index] as Item, packed);
    });
  }
  return items.map((item) => placed.get(item) ?? item);
}

/** What a layout arranges: panels, each with its place. A dashboard spec is one. */
export interface Arranged {
  /** The panels. */
  readonly panels: readonly { readonly id: string; readonly grid: PanelGrid }[];
}

/**
 * The layout a spec has before anyone arranges it: every panel at its spec place, shown.
 *
 * @param spec - The spec, or any panels with their places.
 * @returns The layout.
 */
export function specLayout(spec: Arranged): DashboardLayout {
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
  const shown = packSections(layout.panels.filter((panel) => !panel.hidden));
  const placed = new Map(shown.map((panel) => [panel.id, panel]));
  return { ...layout, panels: layout.panels.map((panel) => placed.get(panel.id) ?? panel) };
}

/** A spec as a layout shows it. */
export interface LaidOutSpec {
  /** The spec with the shown panels only, at the layout's places. */
  readonly spec: DashboardSpec;
  /** The ids of the panels the layout hides. */
  readonly hidden: readonly string[];
}

/** Panels as a layout shows them. */
interface LaidOutPanels {
  /** The shown panels, at the layout's places. */
  readonly panels: Panel[];
  /** The ids of the panels the layout hides. */
  readonly hidden: string[];
}

/**
 * Shows panels through a layout: shown panels at the layout's places, hidden ones left out. A
 * panel the layout does not name keeps its own place; an entry naming no panel is ignored.
 *
 * @param panels - The panels.
 * @param layout - The layout.
 * @returns The panels as shown, and the hidden panels' ids.
 */
export function arrangePanels(panels: readonly Panel[], layout: DashboardLayout): LaidOutPanels {
  const entries = new Map(layout.panels.map((panel) => [panel.id, panel]));
  const hidden = panels.filter((panel) => entries.get(panel.id)?.hidden === true);
  const shown = panels
    .filter((panel) => entries.get(panel.id)?.hidden !== true)
    .map((panel) => ({ ...panel, grid: entries.get(panel.id)?.grid ?? panel.grid }));
  return { panels: packSections(shown), hidden: hidden.map((panel) => panel.id) };
}

/**
 * Shows a spec through a layout: shown panels at the layout's places and in its sections, hidden
 * ones left out.
 *
 * @param spec - The spec.
 * @param layout - The layout, or `undefined` for the spec's own.
 * @returns The spec as shown, and the hidden panels' ids.
 */
export function applyLayout(spec: DashboardSpec, layout: DashboardLayout | undefined): LaidOutSpec {
  if (!layout) return { spec, hidden: [] };
  const sectioned = withLayoutSections(spec, layout);
  const { panels, hidden } = arrangePanels(sectioned.panels, layout);
  return { spec: { ...sectioned, panels }, hidden };
}

/**
 * Why a layout does not fit a spec, if it does not: it names every panel of the spec once, and
 * no other, shows at least one, and sets sections only on a dashboard, holding its panels.
 *
 * @param spec - The spec of the version the layout is for, or the panels it arranges.
 * @param layout - The layout.
 * @returns The problems, empty when it fits.
 */
export function layoutProblems(spec: Arranged | DashboardSpec, layout: DashboardLayout): string[] {
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
  const dashboard = 'specVersion' in spec ? spec : undefined;
  return [...problems, ...layoutSectionProblems(dashboard, layout)];
}
