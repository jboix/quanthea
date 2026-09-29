/**
 * The PromQL recipes: a counter's rate, a ratio such as the error rate, histogram percentiles, a
 * gauge, and the top values by label.
 */
import type { PanelQuery } from '@querent/shared';
import type { PanelDraft } from './draft.ts';
import type { RecipeOf } from './request.ts';
import { byClause, metricName, selector } from './text.ts';
import { categoryChart, statView, tableView, timeChart } from './views.ts';

/** The refIds of a panel's queries, in order. */
const refIds = ['A', 'B', 'C', 'D'] as const;

/**
 * A PromQL query of a panel.
 *
 * @param refId - The refId.
 * @param connector - The connector.
 * @param expr - The expression.
 * @param instant - Whether it is evaluated once, at the end of the range.
 * @returns The query.
 */
function promql(refId: string, connector: string, expr: string, instant = false): PanelQuery {
  return { refId, connector, language: 'promql', expr, ...(instant ? { instant: true } : {}) };
}

/**
 * The parts of a draft every recipe fills the same way.
 *
 * @param request - The request.
 * @returns The title, and the description when there is one.
 */
function draftBase(request: { title: string; description?: string | undefined }) {
  return {
    title: request.title,
    ...(request.description === undefined ? {} : { description: request.description }),
  };
}

/**
 * A counter's per-second rate.
 *
 * @param request - The request.
 * @returns The draft.
 */
export function rateDraft(request: RecipeOf<'rate'>): PanelDraft {
  const rate = `rate(${selector(request.metric, request.filters)}[${request.window}])`;
  const expr = `sum${byClause(request.by)} (${rate})`;
  const stat = request.show === 'stat';
  return {
    ...draftBase(request),
    queries: [promql('A', request.connector, expr)],
    view:
      request.show === 'stat'
        ? statView(request.unit, 'last')
        : timeChart(['A'], request.show, request.unit),
    shape: stat ? 'stat' : 'time',
    width: request.width,
  };
}

/**
 * The share of a counter that matches extra filters, such as 5xx over all requests.
 *
 * @param request - The request.
 * @returns The draft.
 */
export function ratioDraft(request: RecipeOf<'ratio'>): PanelDraft {
  const by = byClause(request.by);
  const part = selector(request.metric, [...request.filters, ...request.match]);
  const whole = selector(request.metric, request.filters);
  const expr = `sum${by} (rate(${part}[${request.window}])) / sum${by} (rate(${whole}[${request.window}]))`;
  const stat = request.show === 'stat';
  return {
    ...draftBase(request),
    queries: [promql('A', request.connector, expr)],
    view: stat ? statView('percent', 'max') : timeChart(['A'], 'line', 'percent'),
    shape: stat ? 'stat' : 'time',
    width: request.width,
  };
}

/**
 * Percentiles of a histogram, one query per percentile.
 *
 * @param request - The request.
 * @returns The draft.
 */
export function latencyDraft(request: RecipeOf<'latency'>): PanelDraft {
  const base = metricName(request.metric).replace(/_bucket$/, '');
  const buckets = `rate(${selector(`${base}_bucket`, request.filters)}[${request.window}])`;
  const by = byClause(['le', ...request.by]);
  const queries = request.quantiles.map((quantile, index) =>
    promql(
      refIds[index] ?? 'A',
      request.connector,
      `histogram_quantile(${quantile}, sum${by} (${buckets}))`,
    ),
  );
  const stat = request.show === 'stat';
  const refs = queries.map((query) => query.refId);
  return {
    ...draftBase(request),
    queries: stat ? queries.slice(0, 1) : queries,
    view: stat ? statView(request.unit, 'max') : timeChart(refs, 'line', request.unit),
    shape: stat ? 'stat' : 'time',
    width: request.width,
  };
}

/**
 * A gauge, aggregated.
 *
 * @param request - The request.
 * @returns The draft.
 */
export function gaugeDraft(request: RecipeOf<'gauge'>): PanelDraft {
  const expr = `${request.aggregate}${byClause(request.by)} (${selector(request.metric, request.filters)})`;
  const stat = request.show === 'stat';
  return {
    ...draftBase(request),
    queries: [promql('A', request.connector, expr)],
    view: stat ? statView(request.unit, 'last') : timeChart(['A'], 'line', request.unit),
    shape: stat ? 'stat' : 'time',
    width: request.width,
  };
}

/**
 * The top values of a counter over the whole range, by label, as a table or bars.
 *
 * @param request - The request.
 * @returns The draft.
 */
export function topDraft(request: RecipeOf<'top'>): PanelDraft {
  const increase = `increase(${selector(request.metric, request.filters)}[$__range])`;
  const expr = `topk(${request.limit}, sum${byClause(request.by)} (${increase}))`;
  const table = request.show === 'table';
  return {
    ...draftBase(request),
    queries: [promql('A', request.connector, expr, true)],
    view: table ? tableView([...request.by, 'Value'], 'number') : categoryChart('A', 'bar'),
    shape: table ? 'table' : 'chart',
    width: request.width,
  };
}
