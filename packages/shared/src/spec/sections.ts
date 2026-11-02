/**
 * The sections of a dashboard: the panels that name none first, then each section with its
 * panels. Sections keep the one grid: a panel's place is the same whichever section it sits in.
 */
import type { DashboardSpec, Panel, Section } from './dashboard.ts';
import { isMultiValue, offersAll } from './variables.ts';

/** The most copies of a repeated section drawn. */
export const maxSectionCopies = 12;

/** The most panels a dashboard draws, copies of repeated sections included. */
const maxDrawnPanels = 60;

/** The panels drawn together: above every section, or under one. */
export interface SectionGroup {
  /** The section, or `undefined` for the panels above every section. */
  readonly section: Section | undefined;
  /** Its panels, in the spec's order. */
  readonly panels: readonly Panel[];
}

/**
 * The panels by section, in the order they are drawn. A panel that names no section, or one the
 * spec does not have, sits above every section.
 *
 * @param spec - The spec.
 * @returns The panels above every section, when there are any, then each section.
 */
export function sectionGroups(spec: Pick<DashboardSpec, 'panels' | 'sections'>): SectionGroup[] {
  const sections = spec.sections ?? [];
  const known = new Set(sections.map((section) => section.id));
  const top = spec.panels.filter(
    (panel) => panel.section === undefined || !known.has(panel.section),
  );
  const groups = sections.map((section) => ({
    section,
    panels: spec.panels.filter((panel) => panel.section === section.id),
  }));
  return top.length > 0 ? [{ section: undefined, panels: top }, ...groups] : groups;
}

/**
 * How many copies of a repeated section may be drawn: at most {@link maxSectionCopies}, and at
 * most what keeps the panels drawn within {@link maxDrawnPanels}, the other panels counted once.
 *
 * @param spec - The spec.
 * @param section - The section's id.
 * @returns The most copies.
 */
export function copyLimit(spec: Pick<DashboardSpec, 'panels'>, section: string): number {
  const own = spec.panels.filter((panel) => panel.section === section).length;
  if (own === 0) return maxSectionCopies;
  const others = spec.panels.length - own;
  return Math.max(0, Math.min(maxSectionCopies, Math.floor((maxDrawnPanels - others) / own)));
}

/**
 * The problem with what a section repeats over, if any: a variable it does not declare, one that
 * holds one value, or too many panels to draw two copies.
 *
 * @param spec - The spec.
 * @param section - The section.
 * @returns The message, or `undefined`.
 */
function repeatProblem(
  spec: Pick<DashboardSpec, 'panels' | 'variables'>,
  section: Section,
): string | undefined {
  if (section.repeat === undefined) return undefined;
  const variable = spec.variables.find((each) => each.name === section.repeat);
  if (!variable) return `No variable $${section.repeat} to repeat the section for.`;
  if (variable.kind === 'computed' || !(isMultiValue(variable) || offersAll(variable)))
    return `$${section.repeat} holds one value: a repeated section needs one that holds several, with "multi" or "includeAll".`;
  if (copyLimit(spec, section.id) < 2)
    return `The section has too many panels to draw two copies within ${maxDrawnPanels} panels.`;
  return undefined;
}

/**
 * What is wrong with a spec's sections: an id used twice, a panel naming a section the spec does
 * not have, or a repeat over a variable that cannot give two copies.
 *
 * @param spec - The spec.
 * @returns Each problem with its path.
 */
export function sectionProblems(
  spec: Pick<DashboardSpec, 'panels' | 'sections' | 'variables'>,
): { path: string; message: string }[] {
  const ids = (spec.sections ?? []).map((section) => section.id);
  const twice = ids.flatMap((id, index) =>
    ids.indexOf(id) === index
      ? []
      : [{ path: `sections[${index}].id`, message: `Two sections are named "${id}".` }],
  );
  const known = ids.length === 0 ? 'there are none' : `they are ${[...new Set(ids)].join(', ')}`;
  const unknown = spec.panels.flatMap((panel, index) =>
    panel.section === undefined || ids.includes(panel.section)
      ? []
      : [{ path: `panels[${index}].section`, message: `No section "${panel.section}": ${known}.` }],
  );
  const repeats = (spec.sections ?? []).flatMap((section, index) => {
    const message = repeatProblem(spec, section);
    return message ? [{ path: `sections[${index}].repeat`, message }] : [];
  });
  return [...twice, ...unknown, ...repeats];
}
