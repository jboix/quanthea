/**
 * Completes the charts of the panels an edit built, once their queries have run: each role the
 * agent left out takes a fitting column of the result, and roles naming columns the result has
 * not, or of the wrong type, become problems the agent can fix.
 */
import {
  chartRecipe,
  type DashboardSpec,
  datasetOfFrames,
  fillView,
  type Panel,
} from '@querent/shared';
import type { PanelTest } from '../dashboards.ts';
import type { ChartChoices } from './edit.ts';

/** The completed spec, and the chart problems of each panel. */
export interface Completion {
  /** The spec with the charts completed. */
  readonly spec: DashboardSpec;
  /** What is wrong with the chart of each panel, by panel id. */
  readonly problems: ReadonlyMap<string, readonly string[]>;
}

/**
 * One panel's chart, completed from its first query's result.
 *
 * @param panel - The panel.
 * @param charts - The chart choices.
 * @param tests - The test runs.
 * @returns The panel, or the problems of its chart.
 */
function completed(
  panel: Panel,
  charts: ChartChoices,
  tests: readonly PanelTest[],
): Panel | string[] {
  const choice = charts.get(panel.id);
  const recipe = choice ? chartRecipe(choice.recipe) : undefined;
  const outcome = tests.find((test) => test.panelId === panel.id)?.run.queries[0];
  if (!choice || !recipe || !outcome || outcome.error) return panel;
  const refs = panel.queries.map((query) => query.refId);
  const filled = fillView(recipe, choice, refs, datasetOfFrames(outcome.frames));
  if ('problems' in filled) return filled.problems;
  const markers = panel.view.kind === 'chart' ? panel.view.markers : undefined;
  const view = filled.view.kind === 'chart' && markers ? { ...filled.view, markers } : filled.view;
  return { ...panel, view };
}

/**
 * Completes the charts of the panels an edit built.
 *
 * @param spec - The spec the edit made.
 * @param charts - The chart choice of each panel it built.
 * @param tests - The test run of the spec.
 * @returns The completed spec and the problems.
 */
export function completeCharts(
  spec: DashboardSpec,
  charts: ChartChoices,
  tests: readonly PanelTest[],
): Completion {
  const problems = new Map<string, readonly string[]>();
  const panels = spec.panels.map((panel) => {
    const result = completed(panel, charts, tests);
    if (!Array.isArray(result)) return result;
    problems.set(panel.id, result);
    return panel;
  });
  return { spec: { ...spec, panels }, problems };
}
