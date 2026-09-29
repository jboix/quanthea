/** Turns a panel request into a draft: the recipe's expansion, or a custom panel as given. */
import type { View } from '@querent/shared';
import type { PanelDraft, PanelShape } from './draft.ts';
import { gaugeDraft, latencyDraft, rateDraft, ratioDraft, topDraft } from './promql.ts';
import type { PanelRequest, RecipeOf } from './request.ts';
import { breakdownDraft, rowsDraft, seriesDraft, statDraft } from './sql.ts';

/**
 * Whether a view charts values over time.
 *
 * @param view - The view.
 * @returns `true` for a chart with a time x axis.
 */
export function isTimeChart(view: View): boolean {
  const axis =
    view.kind === 'chart' ? (view.option.xAxis as { type?: unknown } | undefined) : undefined;
  return axis?.type === 'time';
}

/**
 * What a view shows.
 *
 * @param view - The view.
 * @returns Its shape.
 */
function shapeOf(view: View): PanelShape {
  if (view.kind === 'stat' || view.kind === 'table') return view.kind;
  return isTimeChart(view) ? 'time' : 'chart';
}

/**
 * A custom panel, as the request gives it.
 *
 * @param request - The request.
 * @returns The draft.
 */
function customDraft(request: RecipeOf<'custom'>): PanelDraft {
  return {
    title: request.title,
    ...(request.description === undefined ? {} : { description: request.description }),
    queries: request.queries,
    view: request.view,
    shape: shapeOf(request.view),
    width: request.width,
  };
}

/** The expansion of each recipe. */
const expansions: {
  readonly [Name in PanelRequest['recipe']]: (request: RecipeOf<Name>) => PanelDraft;
} = {
  rate: rateDraft,
  ratio: ratioDraft,
  latency: latencyDraft,
  gauge: gaugeDraft,
  top: topDraft,
  'sql-series': seriesDraft,
  'sql-breakdown': breakdownDraft,
  'sql-stat': statDraft,
  'sql-rows': rowsDraft,
  custom: customDraft,
};

/**
 * Expands a panel request.
 *
 * @param request - The request.
 * @returns The draft.
 * @throws {RecipeError} When the request names something a query cannot use.
 */
export function expandPanel(request: PanelRequest): PanelDraft {
  const expand = expansions[request.recipe] as (request: PanelRequest) => PanelDraft;
  return expand(request);
}
