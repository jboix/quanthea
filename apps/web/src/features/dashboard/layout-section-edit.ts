/**
 * Arranging a dashboard's sections by hand, as pure functions over a layout: add, name, order and
 * remove sections, and move a panel into a section or out of every one. Each section is arranged
 * on a grid of its own, so a change in one never moves the panels of another.
 */
import {
  type DashboardLayout,
  gridColumns,
  type LayoutPanel,
  type LayoutSection,
  type PanelGrid,
} from '@quanthea/shared';
import { placePanel, settle } from './layout-edit.ts';

/** What a version gives an editor to start its sections from. */
export interface SectionedPanels {
  /** The panels, each with the section its spec gives it, if any. */
  readonly panels: readonly { readonly id: string; readonly section?: string | undefined }[];
  /** The spec's sections, in order; left out for what takes no sections, such as a report. */
  readonly sections?: readonly LayoutSection[] | undefined;
}

/**
 * A panel's entry in a section, or in none.
 *
 * @param entry - The entry.
 * @param section - The section, or `undefined` for none.
 * @returns The entry.
 */
function inSectionEntry(entry: LayoutPanel, section: string | undefined): LayoutPanel {
  const { section: _left, ...rest } = entry;
  return section === undefined ? rest : { ...rest, section };
}

/**
 * The layout with its sections set: the spec's, with each panel in its spec section, when the
 * layout sets none yet, and each section's panels risen to its top. What takes no sections keeps
 * its layout.
 *
 * @param version - The panels and the spec's sections.
 * @param layout - The layout to start from.
 * @returns The layout, its sections set when the version takes them.
 */
export function withSections(version: SectionedPanels, layout: DashboardLayout): DashboardLayout {
  const { sections } = version;
  if (!sections) return layout;
  const sectioned = layout.sections ? layout : specSections(version.panels, sections, layout);
  // Each section starts at its own top, as it is drawn.
  return groupsOf(sectioned).reduce(
    (current, group) => withPart(current, settle(sectionLayout(current, group))),
    sectioned,
  );
}

/**
 * The spec's sections set on a layout that sets none, each panel in its spec section.
 *
 * @param specPanels - The panels, each with its spec section.
 * @param specOrder - The spec's sections, in order.
 * @param layout - The layout, setting no sections.
 * @returns The layout with the spec's sections.
 */
function specSections(
  specPanels: SectionedPanels['panels'],
  specOrder: readonly LayoutSection[],
  layout: DashboardLayout,
): DashboardLayout {
  const sections = new Map(specPanels.map((panel) => [panel.id, panel.section]));
  const known = new Set(specOrder.map((section) => section.id));
  const panels = layout.panels.map((entry) => {
    const section = sections.get(entry.id);
    return inSectionEntry(entry, section !== undefined && known.has(section) ? section : undefined);
  });
  const ordered = specOrder.map(({ id, title }) => ({ id, title }));
  return { ...layout, sections: ordered, panels };
}

/**
 * The groups drawn while arranging, in order: the panels of no section, where a panel is dropped
 * to take it out of its section, then each section, empty ones included.
 *
 * @param layout - The layout.
 * @returns The section ids, `undefined` for the panels of none.
 */
export function groupsOf(layout: DashboardLayout): (string | undefined)[] {
  return [undefined, ...(layout.sections ?? []).map((section) => section.id)];
}

/**
 * The part of a layout one section holds, to arrange on its own grid.
 *
 * @param layout - The layout.
 * @param section - The section, or `undefined` for the panels of none.
 * @returns The layout of its panels, hidden ones included.
 */
export function sectionLayout(layout: DashboardLayout, section: string | undefined) {
  return { panels: layout.panels.filter((entry) => entry.section === section) };
}

/**
 * The layout with one section's part replaced by an arranged one.
 *
 * @param layout - The layout.
 * @param part - The section's part, as arranged.
 * @returns The layout.
 */
export function withPart(layout: DashboardLayout, part: DashboardLayout): DashboardLayout {
  const arranged = new Map(part.panels.map((entry) => [entry.id, entry]));
  return { ...layout, panels: layout.panels.map((entry) => arranged.get(entry.id) ?? entry) };
}

/**
 * Changes the part of the section that holds a panel, the other sections left as they are.
 *
 * @param layout - The layout.
 * @param id - The panel.
 * @param change - What to do to its section's part.
 * @returns The layout.
 */
export function inPanelSection(
  layout: DashboardLayout,
  id: string,
  change: (part: DashboardLayout) => DashboardLayout,
): DashboardLayout {
  const section = layout.panels.find((entry) => entry.id === id)?.section;
  return withPart(layout, change(sectionLayout(layout, section)));
}

/**
 * The first row under the shown panels of a part.
 *
 * @param part - A section's part.
 * @returns The row.
 */
function bottomOf(part: DashboardLayout): number {
  const shown = part.panels.filter((entry) => !entry.hidden);
  return Math.max(0, ...shown.map((entry) => entry.grid.y + entry.grid.h));
}

/**
 * Moves a panel into a section, at a cell or under its panels at the left edge, or out of every
 * section; it takes its turn where it lands, every panel there rising as far as it goes, and those
 * it leaves rise into its space.
 *
 * @param layout - The layout.
 * @param id - The panel.
 * @param section - The section, or `undefined` for none.
 * @param at - The cell of its top left corner, where it was dropped; under the panels when left out.
 * @returns The layout.
 */
export function moveToSection(
  layout: DashboardLayout,
  id: string,
  section: string | undefined,
  at?: { readonly x: number; readonly y: number },
): DashboardLayout {
  const entry = layout.panels.find((each) => each.id === id);
  if (!entry || entry.section === section) return layout;
  const grid: PanelGrid = at
    ? { ...entry.grid, x: Math.min(at.x, gridColumns - entry.grid.w), y: at.y }
    : { ...entry.grid, x: 0, y: bottomOf(sectionLayout(layout, section)) };
  const moved = withPart(layout, { panels: [{ ...inSectionEntry(entry, section), grid }] });
  const left = withPart(moved, settle(sectionLayout(moved, entry.section)));
  return withPart(left, placePanel(sectionLayout(left, section), id, grid, false));
}

/**
 * Adds an empty section at the end, named "New section".
 *
 * @param layout - The layout.
 * @returns The layout.
 */
export function addSection(layout: DashboardLayout): DashboardLayout {
  const sections = layout.sections ?? [];
  const taken = new Set(sections.map((section) => section.id));
  let count = sections.length + 1;
  while (taken.has(`section-${count}`)) count += 1;
  return { ...layout, sections: [...sections, { id: `section-${count}`, title: 'New section' }] };
}

/**
 * Renames a section.
 *
 * @param layout - The layout.
 * @param id - The section.
 * @param title - Its new title, as typed.
 * @returns The layout.
 */
export function renameSection(layout: DashboardLayout, id: string, title: string) {
  const sections = (layout.sections ?? []).map((each) =>
    each.id === id ? { ...each, title } : each,
  );
  return { ...layout, sections };
}

/**
 * Moves a section one place up or down.
 *
 * @param layout - The layout.
 * @param id - The section.
 * @param step - `-1` for up, `1` for down.
 * @returns The layout.
 */
export function moveSection(layout: DashboardLayout, id: string, step: -1 | 1): DashboardLayout {
  const sections = [...(layout.sections ?? [])];
  const from = sections.findIndex((each) => each.id === id);
  const to = from + step;
  const moving = sections[from];
  if (from < 0 || to < 0 || to >= sections.length || !moving) return layout;
  sections.splice(from, 1);
  sections.splice(to, 0, moving);
  return { ...layout, sections };
}

/**
 * Removes a section. Its panels stay, in no section, arranged as they were, under the panels
 * already there.
 *
 * @param layout - The layout.
 * @param id - The section.
 * @returns The layout.
 */
export function removeSection(layout: DashboardLayout, id: string): DashboardLayout {
  const bottom = bottomOf(sectionLayout(layout, undefined));
  // The section's panels keep their arrangement, under the panels of no section.
  const freed = sectionLayout(layout, id).panels.map((entry) => ({
    ...inSectionEntry(entry, undefined),
    grid: { ...entry.grid, y: entry.grid.y + bottom },
  }));
  const emptied = withPart(layout, { panels: freed });
  const settled = withPart(emptied, settle(sectionLayout(emptied, undefined)));
  return { ...settled, sections: (settled.sections ?? []).filter((each) => each.id !== id) };
}

/**
 * Whether a section has no title yet, which the layout cannot be saved with.
 *
 * @param layout - The layout.
 * @returns Whether one is blank.
 */
export function hasBlankSection(layout: DashboardLayout): boolean {
  return (layout.sections ?? []).some((section) => section.title.trim() === '');
}
