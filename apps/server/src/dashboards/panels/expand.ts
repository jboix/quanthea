/**
 * Expands a panel request: its data built into queries, and its chart recipe filled into a view
 * with the roles the agent named. The rest of the roles are filled once the queries have run.
 */
import {
  type ChartChoice,
  type ChartRecipe,
  chartRecipe,
  fillView,
  type Operation,
  operationsSchema,
  type PanelQuery,
  type View,
} from '@quanthea/shared';
import { z } from 'zod';
import { type BuildContext, buildData, moreDataSchema, QueryError } from '../queries/index.ts';
import type { PanelDraft, PanelShape } from './draft.ts';
import { moreHints, operationHints } from './operation-hints.ts';
import type { PanelRequest } from './request.ts';
import { isTimeChart } from './time-chart.ts';

/** A panel's chart choice, and the columns its data says it returns, when it says. */
export interface PanelChart {
  /** The chart choice. */
  readonly choice: ChartChoice;
  /** The columns the data returns, empty when only running it tells. */
  readonly columns: readonly string[];
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
  if (recipe.render === 'table' || recipe.render === 'log') return 'table';
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
  const { recipe, variants, roles, options, timeAxis } = request.chart;
  return {
    recipe,
    variants,
    roles,
    timeAxis,
    unit: request.chart.unit ?? unit,
    overrides: options as ChartChoice['overrides'],
  };
}

/** The refIds of a panel's further data requests, after the first's `A`. */
const furtherRefIds = ['B', 'C', 'D'];

/**
 * The query of one further data request, under its refId.
 *
 * @param input - The request as sent: a raw or a saved query.
 * @param refId - Its refId.
 * @param context - The saved queries the run may use, and each connector's dialect.
 * @returns The query.
 * @throws {QueryError} When it does not fit a raw or saved request, or cannot be built.
 */
function furtherQuery(input: unknown, refId: string, context: BuildContext): PanelQuery {
  const data = moreDataSchema.safeParse(input);
  if (!data.success) {
    const hint = moreHints(data.error.issues);
    throw new QueryError(
      `raw or saved data, ${z.prettifyError(data.error)}${hint ? ` ${hint}` : ''}`,
    );
  }
  const [query] = buildData(data.data, context).queries;
  if (!query) throw new QueryError('it builds no query.');
  return { ...query, refId };
}

/**
 * The queries of a panel's further data requests, each under its own refId.
 *
 * @param request - The panel request.
 * @param context - The saved queries the run may use, and each connector's dialect.
 * @returns The queries, in order.
 * @throws {QueryError} When one cannot be built, its message naming its place in `more`.
 */
function furtherQueries(request: PanelRequest, context: BuildContext): PanelQuery[] {
  return (request.more ?? []).map((input, index) => {
    try {
      return furtherQuery(input, furtherRefIds[index] ?? `Q${index}`, context);
    } catch (error) {
      if (!(error instanceof QueryError)) throw error;
      throw new QueryError(`more[${index}]: ${error.message}`);
    }
  });
}

/**
 * The columns a panel's table has after its operations, as far as the data declares them: each
 * calculated or joined text column joins the declared ones. After a join, an append or a pivot
 * only running tells them.
 *
 * @param columns - The columns the data declares, empty when only running it tells.
 * @param operations - The panel's operations, if any.
 * @returns The columns, empty when they are not known before a run.
 */
function columnsAfter(
  columns: readonly string[],
  operations: readonly Operation[] | undefined,
): readonly string[] {
  if (!operations || columns.length === 0) return columns;
  if (
    operations.some((step) => step.op !== 'calculate' && step.op !== 'concat' && step.op !== 'sort')
  )
    return [];
  const added = operations.flatMap((step) => ('name' in step ? [step.name] : []));
  return [...new Set([...columns, ...added])];
}

/**
 * A panel request's operations, checked against the spec's schema.
 *
 * @param request - The request.
 * @returns The operations, or `undefined` when it has none.
 * @throws {QueryError} When a step does not fit its form.
 */
function operationsOf(request: PanelRequest): Operation[] | undefined {
  if (!request.operations || request.operations.length === 0) return undefined;
  const parsed = operationsSchema.safeParse(request.operations);
  if (parsed.success) return parsed.data;
  const hint = operationHints(parsed.error.issues);
  const issues = z.prettifyError(parsed.error);
  throw new QueryError(`The operations do not fit their forms: ${issues}${hint ? ` ${hint}` : ''}`);
}

/**
 * Checks that each further query is read by an operation: a query no step joins or appends would
 * run for nothing.
 *
 * @param queries - The panel's queries, the first one first.
 * @param operations - Its operations, if any.
 * @throws {QueryError} Naming a further query no step reads.
 */
function checkFurtherRead(
  queries: readonly PanelQuery[],
  operations: readonly Operation[] | undefined,
): void {
  const read = new Set((operations ?? []).flatMap((step) => ('with' in step ? [step.with] : [])));
  const unread = queries.slice(1).find((query) => !read.has(query.refId));
  if (unread)
    throw new QueryError(
      `The data in "more" with refId ${unread.refId} is read by no operation: join or append it, or leave it out.`,
    );
}

/**
 * Expands a panel request.
 *
 * @param request - The request.
 * @param context - The saved queries the run may use, and each connector's dialect.
 * @returns The draft, and the chart choice and the declared columns, to complete the chart once the
 *   queries have run.
 * @throws {QueryError} When the data or the chart cannot be built.
 */
export function expandPanel(
  request: PanelRequest,
  context: BuildContext = { saved: [] },
): PanelDraft & { chart: PanelChart } {
  const built = buildData(request.data, context);
  const operations = operationsOf(request);
  const queries = [...built.queries, ...furtherQueries(request, context)];
  checkFurtherRead(queries, operations);
  const recipe = chartRecipe(request.chart.recipe);
  if (!recipe) throw new QueryError(`No chart recipe "${request.chart.recipe}".`);
  const choice = choiceOf(request, built.output.unit);
  // The operations' table takes the first query's place, so the view reads that one alone.
  const drawn = operations ? queries.slice(0, 1) : queries;
  const filled = fillView(
    recipe,
    choice,
    drawn.map((query) => query.refId),
  );
  if ('problems' in filled) throw new QueryError(filled.problems.join(' '));
  return {
    title: request.title,
    ...(request.description === undefined ? {} : { description: request.description }),
    queries,
    ...(operations ? { operations } : {}),
    view: filled.view,
    shape: shapeOf(recipe, filled.view),
    width: request.width,
    ...(built.definition ? { definition: built.definition } : {}),
    chart: { choice, columns: columnsAfter(built.output.columns, operations) },
  };
}
