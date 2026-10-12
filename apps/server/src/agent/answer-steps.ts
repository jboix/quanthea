/**
 * The model's steps of one answer. A pass runs the model until the answer holds, its tries are
 * spent, a limit is reached, or a step calls no tool. The first pass may read; the forced pass
 * follows a step that called no tool, and may only give the answer from what was already read.
 */
import { vendorOf } from '@quanthea/shared';
import {
  type FinishReason,
  type LanguageModelUsage,
  type ModelMessage,
  type StopCondition,
  streamText,
  type TextStreamPart,
  type ToolSet,
  toUIMessageStream,
  type UIMessageStreamWriter,
} from 'ai';
import { type StalledStep, stalledStep, withoutViolations } from './answer-ending.ts';
import { runTools } from './answer-run-tools.ts';
import { answerTools } from './answer-tools.ts';
import type { AnswerDependencies, AnswerMessage, PreparedAnswer } from './answer-types.ts';
import { withCachedTail } from './cache.ts';
import { withoutReasoning } from './compact.ts';
import { modelIdFor, reasoningOption } from './model.ts';
import { publicError } from './public-error.ts';
import { tokensOf, withStep } from './usage.ts';

/** How many answers the model may give: the first, and one repair. */
export const answerTries = 2;

/** One pass of the model over an answer. */
export interface Pass {
  /** The conversation the pass starts from. */
  readonly messages: ModelMessage[];
  /** Whether every step may only give the answer. */
  readonly forced: boolean;
  /** Streams the model's parts, when given. */
  readonly writer?: UIMessageStreamWriter<AnswerMessage> | undefined;
}

/** How a pass ended. */
export interface PassEnd {
  /** Why the model call failed, if it did. */
  readonly failure?: string;
  /** The step that ended the pass with no tool call, if one did. */
  readonly stalled?: StalledStep | undefined;
  /** What the pass added to the conversation: the model's calls and their results. */
  readonly said: readonly ModelMessage[];
}

/**
 * When a pass stops: once the answer holds, once its tries are spent, or past the tool call
 * limit, which leaves room for the forced answer and its repair. A forced pass has as many steps
 * as the answer has tries.
 *
 * @param prepared - The answer.
 * @param forced - Whether the pass may only give the answer.
 * @returns The stop conditions.
 */
function stopConditions(prepared: PreparedAnswer, forced: boolean): StopCondition<ToolSet>[] {
  const { state } = prepared.tools;
  const limit = prepared.resolved.settings.limits.toolCallsPerTurn + answerTries;
  return [
    () => state.given !== undefined,
    () => state.failedAnswers >= answerTries,
    ({ steps }) => forced && steps.length >= answerTries,
    ({ steps }) => steps.reduce((sum, step) => sum + step.toolCalls.length, 0) >= limit,
  ];
}

/**
 * What the next step may do: anything while within the limits, then only give the answer, as
 * every step of a forced pass. Every step marks the conversation so far as a cache point for
 * Anthropic.
 *
 * @param prepared - The answer.
 * @param forced - Whether the pass may only give the answer.
 * @returns The step callback.
 */
function stepSettings(prepared: PreparedAnswer, forced: boolean) {
  const { limits, provider } = prepared.resolved.settings;
  return ({
    steps,
    messages,
  }: {
    steps: readonly { toolCalls: readonly unknown[] }[];
    messages: ModelMessage[];
  }) => {
    // Each step reads the conversation so far from Anthropic's cache, as the agent's steps do,
    // and sends back no thinking block: they are bound to instructions and tools that change.
    const cached = { messages: withCachedTail(withoutReasoning(messages, provider), provider) };
    const calls = steps.reduce((sum, step) => sum + step.toolCalls.length, 0);
    const within = calls < limits.toolCallsPerTurn && prepared.tokens < limits.threadTokens;
    if (within && !forced) return cached;
    return {
      ...cached,
      activeTools: ['give_answer'],
      toolChoice: { type: 'tool' as const, toolName: 'give_answer' },
    };
  };
}

/**
 * Records a step's tokens: in the answer's usage, and in the ledger against who asked, as a
 * question or a panel explanation by the request's mode.
 *
 * @param dependencies - The service's dependencies.
 * @param prepared - The answer.
 * @returns The step callback.
 */
function countStep(dependencies: AnswerDependencies, prepared: PreparedAnswer) {
  const { settings, providerName } = prepared.resolved;
  const model = modelIdFor(settings, 'answer');
  const { actor: userId, dashboardId, mode } = prepared.request;
  const feature = mode === 'ask' ? 'question' : 'explanation';
  const vendor = vendorOf(settings);
  return ({ usage }: { usage: LanguageModelUsage }) => {
    prepared.tokens += usage.totalTokens ?? 0;
    prepared.usage = withStep(prepared.usage, model, usage);
    const tokens = tokensOf(usage);
    const step = { threadId: null, userId, dashboardId, provider: providerName, model, tokens };
    dependencies.usage.recordStep({ ...step, vendor, job: 'answer', feature });
  };
}

/**
 * Starts the model on a pass of a prepared answer.
 *
 * @param dependencies - The service's dependencies.
 * @param prepared - The answer.
 * @param pass - The conversation to start from, and whether the pass is forced.
 * @returns The streaming result.
 */
function start(dependencies: AnswerDependencies, prepared: PreparedAnswer, pass: Pass) {
  const tools: ToolSet = { ...answerTools(prepared.tools), ...runTools(prepared.tools) };
  return streamText({
    model: prepared.model,
    instructions: prepared.instructions,
    messages: pass.messages,
    tools,
    toolChoice: 'required',
    prepareStep: stepSettings(prepared, pass.forced),
    ...reasoningOption(prepared.resolved.settings),
    stopWhen: stopConditions(prepared, pass.forced),
    abortSignal: prepared.request.signal,
    // Two retries ride out a per-minute limit; a spent daily quota is not retried (quota.ts).
    maxRetries: 2,
    onStepEnd: countStep(dependencies, prepared),
  });
}

/**
 * Copies a pass's stream into the writer as UI chunks, and waits for its end, so what the run
 * writes after it comes after every part of the model's message. The message starts with the first
 * pass, and its finish is left for the run to write last.
 *
 * @param parts - The model's stream.
 * @param pass - The pass, with the writer.
 * @param writer - The writer.
 */
async function relay(
  parts: ReadableStream<TextStreamPart<ToolSet>>,
  pass: Pass,
  writer: UIMessageStreamWriter<AnswerMessage>,
): Promise<void> {
  const chunks = toUIMessageStream<ToolSet, AnswerMessage>({
    stream: parts,
    onError: publicError,
    sendStart: !pass.forced,
    sendFinish: false,
  }).getReader();
  for (let read = await chunks.read(); !read.done; read = await chunks.read()) {
    writer.write(read.value);
  }
}

/**
 * Reads a pass's stream to its end and drops it. A broken stream is left to the result's steps,
 * which fail with the same error.
 *
 * @param parts - The model's stream.
 */
async function drain(parts: ReadableStream<TextStreamPart<ToolSet>>): Promise<void> {
  const reader = parts.getReader();
  try {
    for (let read = await reader.read(); !read.done; read = await reader.read());
  } catch {
    // The steps report it.
  }
}

/**
 * Runs one pass of the model to its end.
 *
 * @param dependencies - The service's dependencies.
 * @param prepared - The answer.
 * @param pass - The conversation to start from, whether it is forced, and the writer.
 * @returns How the pass ended; a failing model call is a failure, not a rejection.
 */
export async function runPass(
  dependencies: AnswerDependencies,
  prepared: PreparedAnswer,
  pass: Pass,
): Promise<PassEnd> {
  let violation: FinishReason | undefined;
  const result = start(dependencies, prepared, pass);
  const parts = withoutViolations(result.stream, (finish) => {
    violation = finish;
  });
  if (pass.writer) await relay(parts, pass, pass.writer);
  else await drain(parts);
  try {
    const steps = await result.steps;
    const said = await result.responseMessages;
    return { stalled: stalledStep(steps.at(-1), violation), said };
  } catch (error) {
    return { failure: publicError(error), said: [] };
  }
}
