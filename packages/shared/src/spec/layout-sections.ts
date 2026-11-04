/**
 * The sections a layout sets: the spec seen through them, and what is wrong with them. Sections
 * are presentation, like places: the layout orders and names them and says which panel each
 * holds, and a section the spec repeats keeps its repeat and its folding.
 */
import type { DashboardSpec, Panel, Section } from './dashboard.ts';
import type { DashboardLayout } from './layout-schema.ts';
import { sectionProblems } from './sections.ts';

/**
 * The sections of a spec as a layout sets them, each keeping what the spec says of it besides
 * its title.
 *
 * @param spec - The spec.
 * @param layout - The layout.
 * @returns The sections, or the spec's own when the layout sets none.
 */
function sectionsThrough(spec: DashboardSpec, layout: DashboardLayout): Section[] | undefined {
  if (!layout.sections) return spec.sections;
  const own = new Map((spec.sections ?? []).map((section) => [section.id, section]));
  return layout.sections.map((section) => ({ ...own.get(section.id), ...section }));
}

/**
 * A spec's panels in the sections a layout gives them.
 *
 * @param spec - The spec.
 * @param layout - The layout.
 * @returns The spec with the layout's sections, or the spec when the layout sets none.
 */
export function withLayoutSections(spec: DashboardSpec, layout: DashboardLayout): DashboardSpec {
  if (!layout.sections) return spec;
  const entries = new Map(layout.panels.map((panel) => [panel.id, panel]));
  const panels = spec.panels.map((panel): Panel => {
    const entry = entries.get(panel.id);
    if (!entry) return panel;
    const { section: _left, ...rest } = panel;
    return entry.section === undefined ? rest : { ...rest, section: entry.section };
  });
  const sections = sectionsThrough(spec, layout);
  return { ...spec, panels, ...(sections ? { sections } : {}) };
}

/**
 * What is wrong with the sections a layout sets: an id used twice, a panel in a section the
 * layout does not set, a section on a version that has none, or a repeated section given more
 * panels than its copies can draw.
 *
 * @param spec - The spec arranged, or `undefined` for panels that take no sections.
 * @param layout - The layout.
 * @returns The problems, empty when there are none.
 */
export function layoutSectionProblems(
  spec: DashboardSpec | undefined,
  layout: DashboardLayout,
): string[] {
  const placed = layout.panels.filter((panel) => panel.section !== undefined);
  if (!layout.sections)
    return placed.length > 0 ? ['A panel names a section, but the layout sets none.'] : [];
  if (!spec) return ['Only a dashboard has sections.'];
  return sectionProblems(withLayoutSections(spec, layout)).map((problem) => problem.message);
}
