/**
 * The sections an edit gives a dashboard: each with its id, its title, whether it starts folded,
 * and the panels it holds, by id or by title. The tool takes each section as a plain object, and
 * this checks its form, so the sections cost the tool's schema almost nothing.
 */
import { type DashboardSpec, type Panel, type Section, sectionSchema } from '@quanthea/shared';
import { z } from 'zod';
import { QueryError } from '../queries/index.ts';

/** Validates one section of an edit: a section of the spec, with the panels it holds. */
const sectionRequestSchema = sectionSchema.extend({
  panels: z.array(z.string().min(1).max(200)).max(60).default([]),
});

/** One section of an edit. */
type SectionRequest = z.output<typeof sectionRequestSchema>;

/**
 * Checks the form of one section of an edit.
 *
 * @param section - The section, as the edit gives it.
 * @returns The section.
 * @throws {QueryError} Naming what does not fit the form.
 */
function parsedSection(section: unknown): SectionRequest {
  const parsed = sectionRequestSchema.safeParse(section);
  if (parsed.success) return parsed.data;
  throw new QueryError(`A section does not fit its form: ${z.prettifyError(parsed.error)}`);
}

/**
 * The id of the panel a section names.
 *
 * @param panels - The dashboard's panels.
 * @param name - A panel's id or title.
 * @returns The panel's id.
 * @throws {QueryError} For a name no panel has, listing the panels.
 */
function panelNamed(panels: readonly Panel[], name: string): string {
  const found =
    panels.find((panel) => panel.id === name) ?? panels.find((panel) => panel.title === name);
  if (found) return found.id;
  const known = panels.map((panel) => `${panel.id} (${panel.title})`).join(', ');
  throw new QueryError(`A section names "${name}", which no panel is. The panels are: ${known}.`);
}

/**
 * The dashboard with the sections an edit gives it. They replace its sections, and a panel no
 * section names sits above them all.
 *
 * @param spec - The dashboard, its panels edited.
 * @param sections - The sections as the edit gives them, if it gives any.
 * @returns The dashboard with its sections and each panel's section.
 * @throws {QueryError} For a section that does not fit its form, or that names no panel.
 */
export function withSections(
  spec: DashboardSpec,
  sections: readonly unknown[] | undefined,
): DashboardSpec {
  if (sections === undefined) return spec;
  const parsed = sections.map(parsedSection);
  const holder = new Map<string, string>();
  for (const section of parsed) {
    for (const name of section.panels) holder.set(panelNamed(spec.panels, name), section.id);
  }
  const panels = spec.panels.map(({ section: _, ...panel }) => {
    const section = holder.get(panel.id);
    return section === undefined ? panel : { ...panel, section };
  });
  const kept: Section[] = parsed.map(({ panels: _, ...section }) => section);
  return { ...spec, sections: kept, panels };
}
