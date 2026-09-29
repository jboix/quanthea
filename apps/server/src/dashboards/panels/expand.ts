/**
 * Expands a panel request: its data built into queries, and its chart recipe filled into a view
 * with the roles the agent named. The rest of the roles are filled once the queries have run.
 */
import {
  type ChartChoice,
  type ChartRecipe,
  chartRecipe,
  fillView,
  type SavedQuery,
  type View,
} from '@querent/shared';
import { buildData, QueryError } from '../queries/index.ts';
import type { PanelDraft, PanelShape } from './draft.ts';
import type { PanelRequest } from './request.ts';

/**
 * Whether a view is a chart over time, which deploy markers go on.
 *
 * @param view - The view.
 * @returns Whether its x axis is a time axis.
 */
export function isTimeChart(view: View): boolean {
  if (view.kind !== 'chart') return false;
  const xAxis = view.option.xAxis;
  const axes = Array.isArray(xAxis) ? xAxis : [xAxis];
  return axes.some(
    (axis) =>
      typeof axis === 'object' && axis !== null && !Array.isArray(axis) && axis.type === 'time',
  );
}

/**
 * What a panel shows, which decides its size.
 *
 * @param recipe - Its chart recipe.
 * @param view - Its view.
 * @returns The shape.
 */
function shapeOf(recipe: ChartRecipe, view: View): PanelShape {
  if (recipe.render === 'stat' || recipe.family === 'kpi') return 'stat';
  if (recipe.render === 'table') return 'table';
  return isTimeChart(view) && recipe.prepare !== 'facets' ? 'time' : 'chart';
}

/**
 * The chart choice of a panel request, with the unit its data usually has.
 *
 * @param request - The panel request.
 * @param unit - The data's usual unit.
 * @returns The choice.
 */
export function choiceOf(request: PanelRequest, unit: ChartChoice['unit']): ChartChoice {
  const { recipe, variants, roles, options } = request.chart;
  return {
    recipe,
    variants,
    roles,
    unit: request.chart.unit ?? unit,
    overrides: options as ChartChoice['overrides'],
  };
}

/**
 * Expands a panel request.
 *
 * @param request - The request.
 * @param saved - The saved queries the run may use.
 * @returns The draft, and the chart choice to complete once the queries have run.
 * @throws {QueryError} When the data or the chart cannot be built.
 */
export function expandPanel(
  request: PanelRequest,
  saved: readonly SavedQuery[] = [],
): PanelDraft & { choice: ChartChoice } {
  const built = buildData(request.data, saved);
  const recipe = chartRecipe(request.chart.recipe);
  if (!recipe) throw new QueryError(`No chart recipe "${request.chart.recipe}".`);
  const choice = choiceOf(request, built.output.unit);
  const filled = fillView(
    recipe,
    choice,
    built.queries.map((query) => query.refId),
  );
  if ('problems' in filled) throw new QueryError(filled.problems.join(' '));
  return {
    title: request.title,
    ...(request.description === undefined ? {} : { description: request.description }),
    queries: built.queries,
    view: filled.view,
    shape: shapeOf(recipe, filled.view),
    width: request.width,
    choice,
  };
}
