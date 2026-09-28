/** Scripted language models for agent tests: no network, no provider. */
import { MockLanguageModelV4 } from 'ai/test';

/** Token usage of one mocked step. */
const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

/** One scripted answer: some text, or one tool call. */
export type ScriptedStep =
  | { readonly text: string }
  | { readonly tool: string; readonly input: unknown; readonly id?: string };

/**
 * The content of a scripted answer.
 *
 * @param step - The answer.
 * @param index - Its position, for default ids.
 * @returns The model content.
 */
function contentOf(step: ScriptedStep, index: number) {
  if ('text' in step) return [{ type: 'text' as const, text: step.text }];
  const toolCallId = step.id ?? `call-${index}`;
  return [
    {
      type: 'tool-call' as const,
      toolCallId,
      toolName: step.tool,
      input: JSON.stringify(step.input),
    },
  ];
}

/**
 * A model that answers `generateText` calls from a script, one answer per call.
 *
 * @param steps - The answers, in order.
 * @returns The model.
 */
export function scriptedModel(...steps: ScriptedStep[]): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doGenerate: steps.map((step, index) => ({
      content: contentOf(step, index),
      finishReason: {
        unified: 'text' in step ? ('stop' as const) : ('tool-calls' as const),
        raw: undefined,
      },
      usage,
      warnings: [],
    })),
  });
}
