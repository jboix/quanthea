/**
 * One turn of the model: its instructions, its tools for the thread's phase, when it stops, and
 * what each step records. The run (`run.ts`) prepares the turn and stores the conversation.
 */
import { resolveTime } from '@querent/shared';
import {
  convertToModelMessages,
  type Instructions,
  type LanguageModelUsage,
  type StopCondition,
  streamText,
  type ToolSet,
  toUIMessageStream,
} from 'ai';
import { askPersonTool } from './ask-tool.ts';
import { buildTools, currentSpec } from './build-tools.ts';
import { cachedInstructions, withCachedTail } from './cache.ts';
import { chartTools } from './chart-tools.ts';
import { compactHistory, compactSteps, endingOnPersonTurn } from './compact.ts';
import { dataTools } from './data-tools.ts';
import { guideTools } from './guide-tools.ts';
import { type ModelJob, type ModelOf, modelIdFor, reasoningOption } from './model.ts';
import { phaseOf, phaseTools } from './phases.ts';
import { instructionParts } from './prompt.ts';
import { publicError } from './public-error.ts';
import type { AgentServices, RunContext, ThreadMessage } from './run-context.ts';
import { tokensOf, withStep } from './usage.ts';

/** What the person's latest message tells the agent besides its text. */
export interface TurnHints {
  /** The panels it mentions. */
  readonly mentions: readonly { readonly panelId: string; readonly title: string }[];
  /** The person's IANA time zone, when their browser said. */
  readonly timeZone?: string | undefined;
}

/** The thread's plans, as the turn reads them. */
type Plans = ReturnType<AgentServices['threads']['get']>['plans'];

/**
 * The text of the person's messages in the thread.
 *
 * @param messages - The conversation.
 * @returns The texts, joined.
 */
function questionsOf(messages: readonly ThreadMessage[]): string {
  return messages
    .filter((message) => message.role === 'user')
    .flatMap((message) =>
      message.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])),
    )
    .join(' ');
}

/**
 * The instructions of this turn.
 *
 * @param context - The run.
 * @param messages - The conversation, whose questions trim big connectors' catalogs.
 * @param plans - The thread's plans.
 * @param hints - The panels the person mentions, and their time zone.
 * @param now - The current instant.
 * @returns The instructions, split for the provider's cache.
 */
export async function turnInstructions(
  context: RunContext,
  messages: readonly ThreadMessage[],
  plans: Plans,
  hints: TurnHints,
  now: number,
): Promise<Instructions> {
  const spec = currentSpec(context);
  const { dashboardId, state } = context.threads.row(context.threadId);
  const version =
    dashboardId === null
      ? 0
      : (context.dashboards.get(dashboardId, 'editor').versions.at(-1)?.version ?? 0);
  const latest = plans.at(-1);
  const parts = instructionParts({
    now,
    catalog: await context.modelView.catalog(context.signal, questionsOf(messages)),
    state,
    plan: latest ? { body: latest.body, status: latest.status } : undefined,
    draft: spec ? { version, spec } : undefined,
    mentions: hints.mentions,
    timeZone: hints.timeZone,
    declinedMatches: messages.at(-1)?.parts.some((part) => part.type === 'data-matches') ?? false,
    queries: context.queries,
    charts: context.charts,
    languages: [...new Set(context.modelView.connectors().map((connector) => connector.language))],
    guides: context.modelView.guides(),
  });
  return cachedInstructions(parts, context.settings.provider);
}

/**
 * Every tool the agent has; the phase decides which ones a step offers.
 *
 * @param context - The run.
 * @param now - The clock, for test queries' relative times.
 * @returns The tools.
 */
function turnTools(context: RunContext, now: () => number) {
  return {
    ...dataTools(context, (expression) => resolveTime(expression, now())),
    ...buildTools(context),
    ...chartTools(context.charts),
    ...guideTools(context.modelView.guides()),
    ask_person: askPersonTool(context),
  };
}

/**
 * When the turn stops: at the tool call limit, when a plan waits, when the agent asked the person,
 * or when failed writes reach the repair attempts.
 *
 * @param context - The run.
 * @returns The stop conditions.
 */
function stopConditions(context: RunContext): StopCondition<ToolSet>[] {
  const { limits } = context.settings;
  const toolCalls: StopCondition<ToolSet> = ({ steps }) =>
    steps.reduce((sum, step) => sum + step.toolCalls.length, 0) >= limits.toolCallsPerTurn;
  return [
    toolCalls,
    () => context.counters.planPending,
    () => context.counters.asked,
    () => context.counters.failedWrites >= limits.repairAttempts,
  ];
}

/**
 * Records a step's tokens: on the thread, for its budget; by model, for the answer's usage; and
 * in the ledger.
 * Counted per step, so a run that fails halfway still records what it spent.
 *
 * @param context - The run.
 * @returns The step callback.
 */
function countStep(context: RunContext) {
  return ({ usage }: { usage: LanguageModelUsage }) => {
    const { modelId: model, job } = context.counters;
    context.threads.addTokens(context.threadId, usage.totalTokens ?? 0);
    context.counters.usage = withStep(context.counters.usage, model, usage);
    const { threadId, providerName: provider } = context;
    context.usage.recordStep({ threadId, provider, model, job, tokens: tokensOf(usage) });
  };
}

/**
 * The model of the next step: the repair model once a write has failed in this run, else the
 * model of the turn's job. Its id is kept for the step's usage.
 *
 * @param context - The run.
 * @param modelOf - Gives the model of a job.
 * @param job - The turn's job.
 * @returns The step's model.
 */
function stepModel(context: RunContext, modelOf: ModelOf, job: ModelJob) {
  const stepJob: ModelJob = context.counters.failedWrites > 0 ? 'repair' : job;
  context.counters.modelId = modelIdFor(context.settings, stepJob);
  context.counters.job = stepJob;
  return { model: modelOf(stepJob) };
}

/**
 * Streams one turn of the model into the writer, with the answer's usage in its metadata.
 *
 * @param context - The run.
 * @param modelOf - Gives the model of a job: plan while planning, build after, repair once a
 *   write has failed.
 * @param messages - The conversation.
 * @param instructions - The turn's instructions.
 * @param now - The clock.
 */
export async function streamTurn(
  context: RunContext,
  modelOf: ModelOf,
  messages: ThreadMessage[],
  instructions: Instructions,
  now: () => number,
): Promise<void> {
  const tools = turnTools(context, now);
  const { state } = context.threads.row(context.threadId);
  const job = phaseOf(state) === 'planning' ? 'plan' : 'build';
  context.counters.modelId = modelIdFor(context.settings, job);
  context.counters.job = job;
  const result = streamText({
    model: modelOf(job),
    instructions,
    messages: await convertToModelMessages(compactHistory(messages), { tools }),
    prepareStep: ({ messages: next }) => ({
      ...stepModel(context, modelOf, job),
      messages: withCachedTail(endingOnPersonTurn(compactSteps(next)), context.settings.provider),
    }),
    tools,
    activeTools: [...phaseTools[phaseOf(state)]],
    ...reasoningOption(context.settings),
    stopWhen: stopConditions(context),
    abortSignal: context.signal,
    // Two retries ride out a per-minute limit; a spent daily quota is not retried (quota.ts).
    maxRetries: 2,
    onStepEnd: countStep(context),
  });
  const messageMetadata = ({ part }: { part: { type: string } }) =>
    part.type === 'finish' ? { usage: context.counters.usage } : undefined;
  context.writer.merge(
    toUIMessageStream({ stream: result.stream, onError: publicError, messageMetadata }),
  );
}
