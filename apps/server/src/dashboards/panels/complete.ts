/**
 * Completes the charts of the panels an edit built, once their queries have run: each role the
 * agent left out takes a fitting column of the result, and roles naming columns the result has
 * not, or of the wrong type, become problems the agent can fix.
 */
import {
  type ChartRecipe,
  chartRecipe,
  type DashboardSpec,
  type Dataset,
  type Dimension,
  datasetOfFrames,
  type Frame,
  fillView,
  type Panel,
  type RoleColumns,
} from '@quanthea/shared';
import type { PanelTest } from '../dashboards.ts';
import type { ChartChoices } from './edit.ts';

/**
 * A panel whose raw query returned nothing that tells its columns: kept as asked, but a table
 * needs its columns named. Column options do not count: they change columns, they never choose
 * them, so a table left with them alone would show those columns only once data arrives.
 *
 * @param panel - The panel.
 * @param roles - The roles the chart names.
 * @returns The panel, or the problem of a table with no columns named.
 */
function emptyTable(panel: Panel, roles: RoleColumns | undefined): Panel | string[] {
  const named = [roles?.columns ?? []].flat();
  if (panel.view.kind !== 'table' || named.length > 0) return panel;
  return [
    'The query returned no rows, so the table cannot tell its columns: name them in roles.columns.',
  ];
}

/** The completed spec, and the chart problems of each panel. */
export interface Completion {
  /** The spec with the charts completed. */
  readonly spec: DashboardSpec;
  /** What is wrong with the chart of each panel, by panel id. */
  readonly problems: ReadonlyMap<string, readonly string[]>;
}

/**
 * The part of a result a chart is completed from, such as the result without the columns the
 * model may not see.
 *
 * @param connector - The connector the query ran on.
 * @param frames - The result's frames.
 * @returns The frames to complete the chart from.
 */
type ResultFilter = (connector: string, frames: readonly Frame[]) => readonly Frame[];

/**
 * The whole result.
 *
 * @param _connector - The connector, unused.
 * @param frames - The result's frames.
 * @returns The frames.
 */
const wholeResult: ResultFilter = (_connector, frames) => frames;

/** Column names that hold numbers in the tables query builders return. */
const numberColumns: ReadonlySet<string> = new Set(['value', 'Value']);

/**
 * The type of a declared column: `time` a time, `value` a number, the rest text, as the query
 * builders write them.
 *
 * @param name - The column.
 * @returns Its type.
 */
function declaredType(name: string): Dimension['type'] {
  if (name === 'time') return 'time';
  return numberColumns.has(name) ? 'number' : 'string';
}

/**
 * The table a result without rows still describes, for a table chart: its fields, which a result
 * of no rows keeps when the source names its columns, as SQL does.
 *
 * @param recipe - The chart's recipe.
 * @param frames - The result's frames.
 * @returns The fields as an empty table, or `undefined` for another chart or a result with none.
 */
function fieldsOf(recipe: ChartRecipe, frames: readonly Frame[]): Dataset | undefined {
  if (recipe.render !== 'table' || (frames[0]?.fields.length ?? 0) === 0) return undefined;
  return datasetOfFrames(frames);
}

/**
 * The table a chart is completed from: the result, or when it has no rows, the table the data
 * says it returns, since an empty result is data, not a mistake. A table chart over a raw query
 * takes the fields of the empty result.
 *
 * @param frames - The result's frames.
 * @param chart - The chart's recipe and the columns its data declares.
 * @returns The table, or `undefined` when the result is empty and tells no column.
 */
function tableFor(
  frames: readonly Frame[],
  chart: { readonly recipe: ChartRecipe; readonly columns: readonly string[] },
): Dataset | undefined {
  const result = datasetOfFrames(frames);
  if (result.source.length > 0) return result;
  const { columns } = chart;
  if (columns.length === 0) return fieldsOf(chart.recipe, frames);
  return { dimensions: columns.map((name) => ({ name, type: declaredType(name) })), source: [] };
}

/**
 * The connector of a panel's first query, the one its chart is completed from.
 *
 * @param panel - The panel.
 * @returns The connector name, empty when the panel has no query.
 */
function connectorOf(panel: Panel): string {
  return panel.queries[0]?.connector ?? '';
}

/**
 * One panel's chart, completed from its first query's result.
 *
 * @param panel - The panel.
 * @param charts - The chart choices.
 * @param tests - The test runs.
 * @param filter - The part of each result the chart is completed from.
 * @returns The panel, or the problems of its chart.
 */
function completed(
  panel: Panel,
  charts: ChartChoices,
  tests: readonly PanelTest[],
  filter: ResultFilter,
): Panel | string[] {
  const chart = charts.get(panel.id);
  const recipe = chart ? chartRecipe(chart.choice.recipe) : undefined;
  const outcome = tests.find((test) => test.panelId === panel.id)?.run.queries[0];
  if (!chart || !recipe || !outcome || outcome.error) return panel;
  const frames = filter(connectorOf(panel), outcome.frames);
  const table = tableFor(frames, { recipe, columns: chart.columns });
  if (!table) return emptyTable(panel, chart.choice.roles);
  const refs = panel.queries.map((query) => query.refId);
  const filled = fillView(recipe, chart.choice, refs, table);
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
 * @param filter - The part of each result a chart is completed from: the whole result by default.
 *   The agent passes the gate's, so a role never names a column the model may not see.
 * @returns The completed spec and the problems.
 */
export function completeCharts(
  spec: DashboardSpec,
  charts: ChartChoices,
  tests: readonly PanelTest[],
  filter: ResultFilter = wholeResult,
): Completion {
  const problems = new Map<string, readonly string[]>();
  const panels = spec.panels.map((panel) => {
    const result = completed(panel, charts, tests, filter);
    if (!Array.isArray(result)) return result;
    problems.set(panel.id, result);
    return panel;
  });
  return { spec: { ...spec, panels }, problems };
}
