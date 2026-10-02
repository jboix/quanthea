/**
 * What is wrong with each panel of an edit beyond its queries' errors: its chart for the data the
 * queries returned, and, for the panels whose queries the edit writes, a query that names a fixed
 * time instead of following the dashboard's range. Panels the edit leaves as they were are not
 * checked again, so an older panel never blocks a new edit.
 */
import { type DashboardSpec, fixedTimeOf } from '@quanthea/shared';
import type { PanelTest } from '../dashboards/dashboards.ts';

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

/**
 * What is wrong with one set of markers: it shows on no chart, its query names a fixed time, or it
 * fails.
 *
 * @param spec - The spec the edit makes.
 * @param id - The set's id.
 * @param tests - The test run of each panel, with the markers of the charts that show them.
 * @returns The messages.
 */
function setIssues(spec: DashboardSpec, id: string, tests: readonly PanelTest[]): string[] {
  const annotation = spec.annotations.find((each) => each.id === id);
  if (!annotation) return [];
  const outcomes = tests.flatMap((test) =>
    test.run.markers.filter((marker) => marker.annotation === id),
  );
  const fixed = fixedTimeOf(annotation.query);
  const failure = outcomes.find((outcome) => outcome.error !== null)?.error?.message;
  return [
    ...(outcomes.length === 0 ? ['No time chart shows the markers: name one in "panels".'] : []),
    ...(fixed ? [`the query ${fixed.replace(/^the query /, '')}`] : []),
    ...(failure ? [`the query fails: ${failure}`] : []),
  ];
}

/**
 * What is wrong with the sets of markers an edit sets, each checked on its own. Sets an edit leaves
 * as they were are not checked again.
 *
 * @param spec - The spec the edit makes.
 * @param sets - The sets the edit sets, in its order.
 * @param tests - The test run of each panel, with the markers of the charts that show them.
 * @returns The issues, each at the path of its set, such as `markers[1]`.
 */
export function markerIssues(
  spec: DashboardSpec,
  sets: readonly { readonly id: string }[],
  tests: readonly PanelTest[],
): { path: string; message: string }[] {
  return sets.flatMap((set, index) =>
    setIssues(spec, set.id, tests).map((message) => ({ path: `markers[${index}]`, message })),
  );
}
