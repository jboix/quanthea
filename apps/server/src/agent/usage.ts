/**
 * A run's token usage by model: counted step by step, and carried over when a run continues an
 * answer, so the answer's metadata holds everything it cost.
 */
import { addUsage, type TokenUsage, type TurnUsage, turnUsageSchema } from '@quanthea/shared';
import type { LanguageModelUsage } from 'ai';
import type { ThreadMessage } from './run-context.ts';

/**
 * One step's tokens, split into fresh input, cache reads, cache writes and output.
 *
 * @param usage - The step's usage, as the AI SDK reports it.
 * @returns The tokens.
 */
export function tokensOf(usage: LanguageModelUsage): TokenUsage {
  const cachedInput = usage.inputTokenDetails.cacheReadTokens ?? 0;
  const cacheWrite = usage.inputTokenDetails.cacheWriteTokens ?? 0;
  const fresh = (usage.inputTokens ?? 0) - cachedInput - cacheWrite;
  return {
    input: usage.inputTokenDetails.noCacheTokens ?? Math.max(0, fresh),
    cachedInput,
    cacheWrite,
    output: usage.outputTokens ?? 0,
  };
}

/**
 * The usage a run starts from: the continued answer's, when the run continues one.
 *
 * @param messages - The conversation the run starts from.
 * @param continuing - Whether the run continues the last answer.
 * @returns The usage so far.
 */
export function startingUsage(messages: readonly ThreadMessage[], continuing: boolean): TurnUsage {
  const last = messages.at(-1);
  if (!continuing || last?.role !== 'assistant') return {};
  return turnUsageSchema.safeParse(last.metadata?.usage).data ?? {};
}

/**
 * Adds a step's tokens to the run's usage.
 *
 * @param usage - The run's usage so far.
 * @param model - The model id the step used.
 * @param step - The step's usage.
 * @returns The new usage.
 */
export function withStep(usage: TurnUsage, model: string, step: LanguageModelUsage): TurnUsage {
  return addUsage(usage, model, tokensOf(step));
}
