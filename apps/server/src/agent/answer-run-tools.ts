/**
 * The tools of an answer about a report's run. `read_run` reads a panel's frozen results, over the
 * run's period or the period before, through the gate: the server computed them when the run ran,
 * so no query runs, and the model sees what each connector's access level allows (level 1 whether
 * the query ran, level 2 the shape, level 3 summaries, level 4 rows). Each read is evidence.
 * `propose_follow_up` proposes alerts and dashboards worth starting; a person starts them.
 */
import {
  type AnswerEvidence,
  type FollowUp,
  followUpSchema,
  maxFollowUps,
  type Panel,
  type QueryOutcome,
} from '@quanthea/shared';
import { tool } from 'ai';
import { z } from 'zod';
import type { AnswerToolContext } from './answer-tools.ts';
import type { FrozenRun } from './frozen-run.ts';
import { withLocalTimes } from './local-times.ts';

/** Which period a read covers. */
type Side = 'run' | 'comparison';

/**
 * The window of a side of the run, epoch milliseconds.
 *
 * @param context - The answer's tools' context.
 * @param run - The run.
 * @param side - The period, or the one before.
 * @returns The window, or `undefined` without a comparison.
 */
function windowOf(context: AnswerToolContext, run: FrozenRun, side: Side) {
  return side === 'run' ? context.range : (run.comparison ?? undefined);
}

/**
 * Shapes one frozen query outcome for the model and records it as evidence.
 *
 * @param context - The answer's tools' context.
 * @param read - The panel, its query, the outcome and the window.
 * @param read.panel - The panel.
 * @param read.query - The query of the panel.
 * @param read.outcome - Its frozen outcome, if the run holds one.
 * @param read.window - The window it covered.
 * @returns What the model receives: the evidence id, the connector and the gate's result.
 */
function recordFrozen(
  context: AnswerToolContext,
  read: {
    readonly panel: Panel;
    readonly query: Panel['queries'][number];
    readonly outcome: QueryOutcome | undefined;
    readonly window: { readonly from: number; readonly to: number };
  },
) {
  const { panel, query, outcome, window } = read;
  const result = outcome
    ? context.modelView.panelResult(query.connector, {
        frames: outcome.frames,
        error: outcome.error?.message ?? null,
      })
    : { ok: false as const, error: 'The run holds no result for this query.' };
  const evidence: AnswerEvidence = {
    id: `e${context.state.evidence.length + 1}`,
    connector: query.connector,
    panelId: panel.id,
    query: { ...query },
    variables: {},
    time: { from: new Date(window.from).toISOString(), to: new Date(window.to).toISOString() },
    result,
    frozen: true,
  };
  context.state.evidence.push(evidence);
  context.onEvidence(evidence);
  const local = withLocalTimes(result, context.timeZone);
  return { evidenceId: evidence.id, refId: query.refId, connector: query.connector, ...local };
}

/**
 * Reads a panel's frozen results over one side of the run.
 *
 * @param context - The answer's tools' context.
 * @param run - The run.
 * @param input - The panel and the side.
 * @param input.panelId - The panel.
 * @param input.period - The run's period, or the one before.
 * @returns One result per query of the panel, or why there is none.
 */
function readFrozen(
  context: AnswerToolContext,
  run: FrozenRun,
  input: { readonly panelId: string; readonly period: Side },
) {
  const panel = context.spec.panels.find((each) => each.id === input.panelId);
  const runs = input.period === 'run' ? run.panels : run.comparisonPanels;
  const window = windowOf(context, run, input.period);
  if (!panel) return { ok: false, error: `The report has no panel "${input.panelId}".` };
  if (!runs || !window) return { ok: false, error: 'This run compares with no period before.' };
  const frozen = runs[panel.id];
  const queries = panel.queries.map((query) => {
    const outcome = frozen?.queries.find((each) => each.refId === query.refId);
    return recordFrozen(context, { panel, query, outcome, window });
  });
  return { ok: true, period: input.period, queries };
}

/**
 * The tool that reads the run's frozen results.
 *
 * @param context - The answer's tools' context.
 * @param run - The run.
 * @returns The tool.
 */
function readRunTool(context: AnswerToolContext, run: FrozenRun) {
  const ids = context.spec.panels.map((panel) => panel.id);
  return tool({
    description:
      "Read a panel's results as the report froze them when it ran, over the run's period (run) or the period before (comparison). No query runs. What you see follows each connector's access level: level 1 whether it ran, level 2 the shape, level 3 summaries, level 4 rows. Each query read gets an evidenceId to cite.",
    inputSchema: z.object({
      panelId: z.enum(ids as [string, ...string[]]),
      period: z.enum(['run', 'comparison']).default('run'),
    }),
    execute: (input) => readFrozen(context, run, input),
  });
}

/**
 * The tool that proposes what to watch next: alerts and dashboards a person may start.
 *
 * @param context - The answer's tools' context.
 * @returns The tool.
 */
function followUpTool(context: AnswerToolContext) {
  return tool({
    description: `Propose at most ${maxFollowUps} things worth watching after this answer, or when asked what to watch: an alert to be told when something happens, or a dashboard to look at. Each prompt is the first message of the conversation a person may start; nothing starts on its own. Call it before give_answer; a second call replaces the first.`,
    inputSchema: z.object({ cards: z.array(followUpSchema).min(1).max(maxFollowUps) }),
    execute: ({ cards }: { cards: FollowUp[] }) => {
      context.state.followUps = cards;
      return { ok: true, shown: cards.length };
    },
  });
}

/**
 * The tools of an answer about a run: `read_run` and `propose_follow_up`.
 *
 * @param context - The answer's tools' context.
 * @returns The tools, none outside a run.
 */
export function runTools(context: AnswerToolContext) {
  const { run } = context;
  if (!run || context.spec.panels.length === 0) return {};
  return { read_run: readRunTool(context, run), propose_follow_up: followUpTool(context) };
}
