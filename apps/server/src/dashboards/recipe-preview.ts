/**
 * Previews one panel request, as the agent would send it: expanded by its recipe, validated, and
 * test-run with its defaults. Nothing is saved.
 */
import { type QueryPreview, queryBuilders, type SavedQuery } from '@querent/shared';
import { z } from 'zod';
import type { Dashboards } from './dashboards.ts';
import { queryText } from './recipes/guide.ts';
import { applyEdit, editRequestSchemaFor, RecipeError } from './recipes/index.ts';

/**
 * The one-panel spec a request becomes, or why it cannot be built.
 *
 * @param panel - The panel request.
 * @param saved - The saved recipes it may name.
 * @param from - How far back it looks, such as `now-24h`.
 * @returns The spec, or the message.
 */
function specOf(
  panel: Readonly<Record<string, unknown>>,
  saved: readonly SavedQuery[],
  from: string,
) {
  const available = { builtIn: queryBuilders.map((recipe) => recipe.id), saved };
  const panels = [{ title: 'Preview', ...panel }];
  const edit = { title: 'Preview', summary: 'preview', time: { from, to: 'now' }, panels };
  const parsed = editRequestSchemaFor(available).safeParse(edit);
  if (!parsed.success) return { message: z.prettifyError(parsed.error) };
  try {
    return { spec: applyEdit(undefined, parsed.data, saved) };
  } catch (error) {
    if (!(error instanceof RecipeError)) throw error;
    return { message: error.message };
  }
}

/**
 * Previews a panel request.
 *
 * @param dashboards - The dashboards service, which validates and test-runs.
 * @param panel - The panel request, without a title.
 * @param saved - The saved recipes it may name, a draft among them.
 * @param from - How far back it looks; the last 24 hours by default.
 * @returns The panel, its queries and its run, or why it cannot be built.
 */
export async function previewPanel(
  dashboards: Pick<Dashboards, 'check' | 'testRun'>,
  panel: Readonly<Record<string, unknown>>,
  saved: readonly SavedQuery[],
  from = 'now-24h',
): Promise<QueryPreview> {
  const built = specOf(panel, saved, from);
  if (!built.spec) return { ok: false, message: built.message, queries: [] };
  const queries = built.spec.panels.flatMap((each) => each.queries.map(queryText));
  const checked = dashboards.check(built.spec);
  if (!checked.ok) {
    const message = checked.issues.map((issue) => issue.message).join(' ');
    return { ok: false, message, queries };
  }
  const [test] = await dashboards.testRun(checked.spec);
  const [first] = checked.spec.panels;
  if (!test || !first) return { ok: false, message: 'The recipe made no panel.', queries };
  return { ok: true, panel: first, queries, run: test.run };
}
