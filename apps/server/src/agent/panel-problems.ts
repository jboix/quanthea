/**
 * What is wrong with each panel of an edit beyond its queries' errors: its chart for the data the
 * queries returned, and, for the panels whose queries the edit writes, a query that names a fixed
 * time instead of following the dashboard's range. Panels the edit leaves as they were are not
 * checked again, so an older panel never blocks a new edit.
 */
import { type DashboardSpec, fixedTimeOf } from '@quanthea/shared';

/**
 * The problems of each panel, by id: the chart's, then each new query that names a fixed time.
 *
 * @param current - The spec before the edit, if any.
 * @param spec - The spec the edit makes.
 * @param chartProblems - What is wrong with each panel's chart, by panel id.
 * @returns The problems, by panel id.
 */
export function panelProblems(
  current: DashboardSpec | undefined,
  spec: DashboardSpec,
  chartProblems: ReadonlyMap<string, readonly string[]>,
): Map<string, string[]> {
  const before = new Map(current?.panels.map((panel) => [panel.id, JSON.stringify(panel.queries)]));
  const problems = new Map(Array.from(chartProblems, ([id, list]) => [id, [...list]]));
  for (const panel of spec.panels) {
    if (before.get(panel.id) === JSON.stringify(panel.queries)) continue;
    const fixed = panel.queries.flatMap((query) => {
      const why = fixedTimeOf(query);
      return why ? [`query ${query.refId}: ${why}`] : [];
    });
    if (fixed.length > 0) problems.set(panel.id, [...(problems.get(panel.id) ?? []), ...fixed]);
  }
  return problems;
}
