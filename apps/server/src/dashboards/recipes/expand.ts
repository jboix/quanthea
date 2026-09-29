/** Turns a panel request into a draft: the recipe's expansion, or a custom panel's raw queries. */
import type { PanelQuery, View } from '@querent/shared';
import type { PanelDraft, PanelShape } from './draft.ts';
import { gaugeDraft, latencyDraft, rateDraft, ratioDraft, topDraft } from './promql.ts';
import type { PanelRequest, RecipeOf } from './request.ts';
import { breakdownDraft, rowsDraft, seriesDraft, statDraft } from './sql.ts';
import { RecipeError } from './text.ts';
import { categoryChart, statView, tableView, timeChart } from './views.ts';

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

/** The refIds of a panel's queries, in order. */
const refIds = ['A', 'B', 'C', 'D'] as const;

/**
 * A custom panel's query.
 *
 * @param raw - The raw query.
 * @param refId - Its refId.
 * @returns The panel query.
 */
function rawQuery(raw: RecipeOf<'custom'>['queries'][number], refId: string): PanelQuery {
  if (raw.language === 'sql')
    return { refId, connector: raw.connector, language: 'sql', sql: raw.query };
  const instant = raw.instant ? { instant: true } : {};
  return { refId, connector: raw.connector, language: 'promql', expr: raw.query, ...instant };
}

/**
 * A chart view with the request's option keys added or overriding.
 *
 * @param view - The chart view.
 * @param option - The option keys, if any.
 * @returns The view.
 */
function withOption(view: View, option: Record<string, unknown> | undefined): View {
  if (view.kind !== 'chart') return view;
  if (option === undefined) return view;
  return { ...view, option: { ...view.option, ...(option as typeof view.option) } };
}

/**
 * The view of a custom panel.
 *
 * @param request - The request.
 * @param refs - The refIds of its queries.
 * @returns The view.
 * @throws {RecipeError} For a table without columns.
 */
function customView(request: RecipeOf<'custom'>, refs: readonly string[]): View {
  const { show, unit } = request;
  if (show === 'stat') return statView(unit, request.reduce);
  if (show === 'table') {
    if (!request.columns?.length) throw new RecipeError('A custom table needs its columns.');
    return tableView(request.columns);
  }
  const chart =
    show === 'line' || show === 'bar'
      ? timeChart(refs, show, unit)
      : categoryChart('A', show === 'pie' ? 'pie' : 'bar');
  return withOption(chart, request.option);
}

/**
 * A custom panel: raw queries and a view kind.
 *
 * @param request - The request.
 * @returns The draft.
 */
function customDraft(request: RecipeOf<'custom'>): PanelDraft {
  const queries = request.queries.map((raw, index) => rawQuery(raw, refIds[index] ?? 'A'));
  const view = customView(
    request,
    queries.map((query) => query.refId),
  );
  return {
    title: request.title,
    ...(request.description === undefined ? {} : { description: request.description }),
    queries,
    view,
    shape: shapeOf(view),
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
