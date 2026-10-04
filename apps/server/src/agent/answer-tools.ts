/**
 * The tools of an answer about a dashboard. `describe` reads a connector's schema. `read_data`
 * test-runs a panel's query or one the model writes, through the gate, and only on connectors whose
 * access level shows numbers; the server records each read as evidence. `give_answer` takes the
 * answer and checks its citations. Nothing writes.
 */
import {
  type AnswerCitation,
  type AnswerEvidence,
  answerCitationSchema,
  type DashboardSpec,
  type FollowUp,
} from '@quanthea/shared';
import { tool } from 'ai';
import { z } from 'zod';
import type { Dashboards } from '../dashboards/dashboards.ts';
import type { ModelView } from '../gate/model-view.ts';
import { answerIssues } from './answer-check.ts';
import type { ResponseWatch } from './answer-watch.ts';
import { testQuerySchema } from './data-tools.ts';
import type { FrozenRun } from './frozen-run.ts';
import { withLocalTimes } from './local-times.ts';

/** The variables of a run, bound as panels bind them. */
type Bindings = Awaited<ReturnType<Dashboards['bindVariables']>>;

/** A query template as the gate's test run takes it. */
type Template = Parameters<ModelView['testQuery']>[1]['template'];

/** What an answer has gathered so far: its reads, the answer it gave, its failed tries. */
export interface AnswerState {
  /** Every read, in order. */
  readonly evidence: AnswerEvidence[];
  /** The answer, once one passed its checks. */
  given: { readonly text: string; readonly citations: readonly AnswerCitation[] } | undefined;
  /** How many answers failed their checks. */
  failedAnswers: number;
  /** What the last failed answer was told to fix, for the record of a failure. */
  lastIssues?: readonly string[];
  /** What the answer proposes to watch next, about a report's run. */
  followUps: readonly FollowUp[];
}

/** What the tools of one answer share. */
export interface AnswerToolContext {
  /** The connectors as the model sees them: the gate. */
  readonly modelView: Pick<
    ModelView,
    'describe' | 'describeSchemaOnly' | 'testQuery' | 'panelResult'
  >;
  /** The dashboard's spec. */
  readonly spec: DashboardSpec;
  /** The dashboard's connectors that exist. */
  readonly connectors: readonly string[];
  /** Whether describe shows only what level 1 shows: an explanation, which every role sees. */
  readonly schemaOnly: boolean;
  /** Those whose access level shows numbers; empty for an explanation. */
  readonly readable: readonly string[];
  /** The time zone of the question: what the model reads is written on its clock. */
  readonly timeZone: string;
  /** The range asked about, epoch milliseconds; `undefined` for an explanation. */
  readonly range: { readonly from: number; readonly to: number } | undefined;
  /** The report's run asked about, frozen, if the question is about one. */
  readonly run?: FrozenRun | undefined;
  /** The viewer's variables, bound. */
  readonly bindings: Bindings;
  /** Aborted when the person leaves. */
  readonly signal: AbortSignal;
  /** The answer's state, which the tools fill. */
  readonly state: AnswerState;
  /** The model's latest response, to know every tool its step calls. */
  readonly watch: ResponseWatch;
  /** Called with each read as it is recorded, to stream it. */
  readonly onEvidence: (evidence: AnswerEvidence) => void;
}

/** What `read_data` runs: a connector and a query template, from a panel or written. */
type ReadTarget =
  | {
      readonly connector: string;
      readonly template: Template;
      readonly refId: string;
      readonly panelId?: string;
    }
  | { readonly error: string };

/** A time window, epoch milliseconds, or why it cannot be read. */
type Window = { readonly from: number; readonly to: number } | { readonly error: string };

/**
 * A names list for the schema: `z.enum` needs at least one.
 *
 * @param names - The names, at least one.
 * @returns The enum.
 */
function namesEnum(names: readonly string[]) {
  return z.enum(names as [string, ...string[]]);
}

/**
 * The tool that describes a connector's schema.
 *
 * @param context - The answer's tools' context.
 * @returns The tool.
 */
function describeTool(context: AnswerToolContext) {
  return tool({
    description:
      "Describe a connector's schema: tables and columns, or metrics and labels. Pass a scope to only list entities whose name contains it.",
    inputSchema: z.object({
      connector: namesEnum(context.connectors),
      scope: z.string().max(100).optional(),
    }),
    execute: ({ connector, scope }) =>
      context.schemaOnly
        ? context.modelView.describeSchemaOnly(connector, scope, context.signal)
        : context.modelView.describe(connector, scope, context.signal),
  });
}

/**
 * The query of a panel to read, if the model may read its connector.
 *
 * @param context - The answer's tools' context.
 * @param panelId - The panel.
 * @param refId - Which of its queries; the first when not given.
 * @returns What to run, or why not.
 */
function panelTarget(context: AnswerToolContext, panelId: string, refId?: string): ReadTarget {
  const panel = context.spec.panels.find((candidate) => candidate.id === panelId);
  if (!panel) {
    const ids = context.spec.panels.map((candidate) => candidate.id).join(', ');
    return { error: `The dashboard has no panel "${panelId}". Panels: ${ids}.` };
  }
  const query = panel.queries.find((candidate) => refId === undefined || candidate.refId === refId);
  if (!query) return { error: `Panel "${panelId}" has no query "${refId}".` };
  if (!context.readable.includes(query.connector))
    return { error: `You cannot read "${query.connector}": its access level shows no numbers.` };
  return { connector: query.connector, template: query, refId: query.refId, panelId };
}

/**
 * What a read runs: a panel's query, or the query the model wrote.
 *
 * @param context - The answer's tools' context.
 * @param input - The read's input.
 * @returns What to run, or why not.
 */
function targetOf(
  context: AnswerToolContext,
  input: z.infer<ReturnType<typeof readInput>>,
): ReadTarget {
  if (input.panelId !== undefined) return panelTarget(context, input.panelId, input.refId);
  if (input.connector === undefined || input.query === undefined)
    return { error: 'Give a panelId, or a connector and a query.' };
  return { connector: input.connector, template: input.query, refId: 'read' };
}

/**
 * The time window of a read: the one asked for, or the range asked about.
 *
 * @param time - The window the model asked for, ISO 8601, if any.
 * @param range - The range asked about.
 * @returns The window, or why it cannot be read.
 */
function windowOf(
  time: { readonly from: string; readonly to: string } | undefined,
  range: { readonly from: number; readonly to: number },
): Window {
  if (time === undefined) return range;
  const from = Date.parse(time.from);
  const to = Date.parse(time.to);
  if (Number.isNaN(from) || Number.isNaN(to))
    return { error: 'time.from and time.to must be ISO 8601 times with an offset.' };
  if (from >= to) return { error: 'The time window ends before it starts.' };
  return { from, to };
}

/**
 * The bound values, as the evidence records them.
 *
 * @param bindings - The bindings.
 * @returns Each variable's value or values.
 */
function boundValues(bindings: Bindings): Record<string, string | string[]> {
  return Object.fromEntries(
    Object.entries(bindings).map(([name, binding]) => [
      name,
      typeof binding.value === 'string' ? binding.value : [...binding.value],
    ]),
  );
}

/**
 * Validates what `read_data` takes.
 *
 * @param readable - The connectors the model may read.
 * @returns The schema.
 */
function readInput(readable: readonly string[]) {
  return z.object({
    panelId: z.string().max(100).optional().describe("A panel's id: runs that panel's query."),
    refId: z.string().max(20).optional().describe("Which of the panel's queries; the first."),
    connector: namesEnum(readable).optional().describe('The connector of a query you write.'),
    query: testQuerySchema.optional().describe("A query you write, in the connector's language."),
    time: z
      .object({ from: z.string().max(40), to: z.string().max(40) })
      .optional()
      .describe(
        'A window, ISO 8601 with offsets, inside or outside the range asked about; that range when left out.',
      ),
  });
}

/**
 * Runs a read through the gate and records it as evidence.
 *
 * @param context - The answer's tools' context.
 * @param target - What to run.
 * @param window - Over which window.
 * @returns What the model receives: the evidence id and the gate's result.
 */
async function recordRead(
  context: AnswerToolContext,
  target: Exclude<ReadTarget, { error: string }>,
  window: { readonly from: number; readonly to: number },
) {
  const timeRange = { from: new Date(window.from), to: new Date(window.to) };
  const { refId, template, connector } = target;
  const request = { refId, template, variables: context.bindings, timeRange };
  const result = await context.modelView.testQuery(connector, {
    ...request,
    signal: context.signal,
  });
  const evidence: AnswerEvidence = {
    id: `e${context.state.evidence.length + 1}`,
    connector,
    ...(target.panelId === undefined ? {} : { panelId: target.panelId }),
    query: { ...template },
    variables: boundValues(context.bindings),
    time: { from: timeRange.from.toISOString(), to: timeRange.to.toISOString() },
    result,
  };
  context.state.evidence.push(evidence);
  context.onEvidence(evidence);
  return { evidenceId: evidence.id, ...withLocalTimes(result, context.timeZone) };
}

/**
 * The tool that reads data: a panel's query or one the model writes, over the range asked about
 * or a window, with the dashboard's variables bound.
 *
 * @param context - The answer's tools' context, with at least one readable connector and a range.
 * @param range - The range asked about.
 * @returns The tool.
 */
function readTool(
  context: AnswerToolContext,
  range: { readonly from: number; readonly to: number },
) {
  return tool({
    description:
      "Read data through your access level: run a panel's query (panelId), or a query you write (connector and query). Level 3 returns per-field summaries, with when the extremes and spikes happened; level 4 also rows. Each read gets an evidenceId to cite.",
    inputSchema: readInput(context.readable),
    execute: async (input) => {
      const target = targetOf(context, input);
      const window = windowOf(input.time, range);
      if ('error' in target) return { ok: false, error: target.error };
      if ('error' in window) return { ok: false, error: window.error };
      return recordRead(context, target, window);
    },
  });
}

/**
 * The tool that takes the final answer and checks it.
 *
 * @param context - The answer's tools' context.
 * @returns The tool.
 */
function giveAnswerTool(context: AnswerToolContext) {
  return tool({
    description:
      'Give your answer: a few plain sentences with markers such as [1], and one citation per marker. Only this reaches the person.',
    inputSchema: z.object({
      text: z.string().max(4000).describe('A few plain sentences with markers such as [1].'),
      citations: z.array(answerCitationSchema).max(50),
    }),
    execute: (given) => checkAnswer(context, given),
  });
}

/** Why an answer given in the same step as a read is refused. */
const sameStepRead =
  'Answer in a step of its own, after your reads: this step also calls read_data, whose results you have not seen. Nothing was recorded as your answer.';

/**
 * Checks an answer once its step's response is complete, so every read of the step is known: an
 * answer beside a read is refused without counting as a try. A failing check counts as one.
 *
 * @param context - The answer's tools' context.
 * @param given - The answer as the model gave it.
 * @returns What the model receives: `{ ok }`, or the issues to fix.
 */
async function checkAnswer(
  context: AnswerToolContext,
  given: { readonly text: string; readonly citations: readonly AnswerCitation[] },
) {
  const calls = (await context.watch.latest) ?? [];
  if (calls.includes('read_data')) return { ok: false, issues: [sameStepRead] };
  const scope = {
    panelIds: new Set(context.spec.panels.map((panel) => panel.id)),
    evidenceIds: new Set(context.state.evidence.map((evidence) => evidence.id)),
    range: context.range,
  };
  const issues = answerIssues(given, scope);
  if (issues.length === 0) {
    context.state.given = given;
    return { ok: true };
  }
  context.state.failedAnswers += 1;
  context.state.lastIssues = issues;
  return { ok: false, issues };
}

/**
 * The tools of one answer: `describe` when the dashboard has connectors, `read_data` when the
 * model may read numbers of one of them over a range, and `give_answer`.
 *
 * @param context - The answer's tools' context.
 * @returns The tools.
 */
export function answerTools(context: AnswerToolContext) {
  const { range } = context;
  return {
    ...(context.connectors.length > 0 ? { describe: describeTool(context) } : {}),
    ...(context.readable.length > 0 && range ? { read_data: readTool(context, range) } : {}),
    give_answer: giveAnswerTool(context),
  };
}
