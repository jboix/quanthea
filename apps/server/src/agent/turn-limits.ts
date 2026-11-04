/**
 * The soft limits of a turn: past the tool calls or the tokens the model settings allow, the turn
 * pauses instead of going on, and its answer ends with a part that says which limit it reached.
 * The person continues it from the thread, which starts a new turn with fresh counts. Without a
 * limit set, a turn never pauses.
 */
import type { TurnLimit } from '@quanthea/shared';
import type { InferUIMessageChunk, LanguageModelUsage } from 'ai';
import type { RunContext, ThreadMessage } from './run-context.ts';

/** One chunk of a thread's UI stream. */
type ThreadChunk = InferUIMessageChunk<ThreadMessage>;

/** What a step that ended reports, as the limits read it. */
interface EndedStep {
  /** The step's tokens. */
  readonly usage: LanguageModelUsage;
  /** The tool calls the step made. */
  readonly toolCalls: readonly unknown[];
}

/**
 * Whether the turn ends after this step anyway: a plan waits, the agent asked the person, it
 * explains what failed, or the step called no tool.
 *
 * @param context - The run.
 * @param step - The step that ended.
 * @returns Whether the turn ends without a pause.
 */
function endsAnyway(context: RunContext, step: EndedStep): boolean {
  const { planPending, asked, explaining } = context.counters;
  return planPending || asked || explaining || step.toolCalls.length === 0;
}

/**
 * The limit the turn is past, the tool calls before the tokens.
 *
 * @param context - The run.
 * @returns The limit, or `undefined` within both or with none set.
 */
function limitPast(context: RunContext): TurnLimit | undefined {
  const { toolCallsPerTurn, tokensPerTurn } = context.settings.limits;
  const { toolCalls, tokens } = context.counters;
  if (toolCallsPerTurn !== null && toolCalls >= toolCallsPerTurn)
    return { kind: 'calls', limit: toolCallsPerTurn, used: toolCalls };
  if (tokensPerTurn !== null && tokens >= tokensPerTurn)
    return { kind: 'tokens', limit: tokensPerTurn, used: tokens };
  return undefined;
}

/**
 * Counts a step's tool calls and tokens, and pauses the turn when it passed a limit and would
 * otherwise go on.
 *
 * @param context - The run.
 * @param step - The step that ended.
 */
export function countLimits(context: RunContext, step: EndedStep): void {
  context.counters.toolCalls += step.toolCalls.length;
  context.counters.tokens += step.usage.totalTokens ?? 0;
  if (endsAnyway(context, step)) return;
  context.counters.paused = limitPast(context);
}

/**
 * The turn's UI stream, with the part of the limit it paused at just before its end, so the part
 * belongs to the answer and shows after its work.
 *
 * @param context - The run.
 * @param stream - The turn's UI stream.
 * @returns The stream.
 */
export function withLimitPart(
  context: RunContext,
  stream: ReadableStream<ThreadChunk>,
): ReadableStream<ThreadChunk> {
  return stream.pipeThrough(
    new TransformStream<ThreadChunk, ThreadChunk>({
      transform(chunk, controller) {
        const { paused } = context.counters;
        if (chunk.type === 'finish' && paused)
          controller.enqueue({ type: 'data-limit', data: paused });
        controller.enqueue(chunk);
      },
    }),
  );
}
