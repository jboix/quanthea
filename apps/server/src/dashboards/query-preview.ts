/**
 * Previews one data request, as the agent would send it: built into queries, run over a time range,
 * and drawn with a chart recipe, the one that suits the data unless another is named. The same
 * steps as the agent's edits, with no model and nothing saved.
 */
import {
  datasetOfFrames,
  type QueryPreview,
  queryBuilders,
  type SavedQuery,
} from '@querent/shared';
import { z } from 'zod';
import type { Dashboards, PanelTest } from './dashboards.ts';
import { applyEdit, completeCharts, editRequestSchemaFor } from './panels/index.ts';
import { buildData, dataSchema, QueryError, queryText } from './queries/index.ts';

/** What a preview needs of the dashboards service. */
type PreviewServices = Pick<Dashboards, 'check' | 'testRun'>;

/**
 * The one-panel edit a preview makes, or why it cannot.
 *
 * @param data - The data request.
 * @param chart - The chart, if one is named.
 * @param saved - The saved queries it may name.
 * @param from - How far back it looks, such as `now-24h`.
 * @returns The spec and its chart choices, or the message.
 */
function previewEdit(
  data: Readonly<Record<string, unknown>>,
  chart: Readonly<Record<string, unknown>> | undefined,
  saved: readonly SavedQuery[],
  from: string,
) {
  const parsedData = dataSchema.safeParse(data);
  if (!parsedData.success) return { message: z.prettifyError(parsedData.error) };
  try {
    const suggested = { recipe: buildData(parsedData.data, saved).output.chart };
    const available = { builtIn: queryBuilders.map((builder) => builder.id), saved };
    const panel = { title: 'Preview', data, chart: chart ?? suggested };
    const edit = {
      title: 'Preview',
      summary: 'preview',
      time: { from, to: 'now' },
      panels: [panel],
    };
    const parsed = editRequestSchemaFor(available).safeParse(edit);
    if (!parsed.success) return { message: z.prettifyError(parsed.error) };
    return applyEdit(undefined, parsed.data, saved);
  } catch (error) {
    if (!(error instanceof QueryError)) throw error;
    return { message: error.message };
  }
}

/**
 * Draws a built preview: completes its chart from the run and checks the result.
 *
 * @param dashboards - The dashboards service, which checks.
 * @param edit - The spec and its chart choices.
 * @param tests - The test run.
 * @param queries - The queries written, for the outcome.
 * @returns The preview.
 */
function drawn(
  dashboards: PreviewServices,
  edit: ReturnType<typeof applyEdit>,
  tests: readonly PanelTest[],
  queries: string[],
): QueryPreview {
  const completed = completeCharts(edit.spec, edit.charts, tests);
  const problems = [...completed.problems.values()].flat();
  const checked = dashboards.check(completed.spec);
  const issues = checked.ok ? [] : checked.issues.map((issue) => issue.message);
  const [panel] = checked.ok ? checked.spec.panels : [];
  const [test] = tests;
  if (problems.length > 0 || !panel || !test) {
    const message = [...problems, ...issues].join(' ') || 'The preview cannot be drawn.';
    return { ok: false, message, queries };
  }
  const columns = datasetOfFrames(test.run.queries[0]?.frames ?? []).dimensions.map(
    (column) => column.name,
  );
  return { ok: true, panel, queries, run: test.run, columns };
}

/**
 * Previews a data request.
 *
 * @param dashboards - The dashboards service, which checks and test-runs.
 * @param request - The data request, the chart if any, the saved queries and the time range.
 * @param request.data - The data request.
 * @param request.chart - The chart, when one is named.
 * @param request.saved - The saved queries it may name, a draft among them.
 * @param request.from - How far back it looks.
 * @returns The panel, its queries, its run and its columns, or why it cannot be built.
 */
export async function previewData(
  dashboards: PreviewServices,
  request: {
    data: Readonly<Record<string, unknown>>;
    chart?: Readonly<Record<string, unknown>> | undefined;
    saved: readonly SavedQuery[];
    from: string;
  },
): Promise<QueryPreview> {
  const edit = previewEdit(request.data, request.chart, request.saved, request.from);
  if (!('spec' in edit))
    return { ok: false, message: edit.message ?? 'The preview cannot be built.', queries: [] };
  const queries = edit.spec.panels.flatMap((panel) => panel.queries.map(queryText));
  const tests = await dashboards.testRun(edit.spec);
  const failure = tests[0]?.run.queries.find((outcome) => outcome.error)?.error;
  if (failure) return { ok: false, message: failure.message, queries };
  return drawn(dashboards, edit, tests, queries);
}
