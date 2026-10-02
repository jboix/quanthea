/** Scripted language models for agent tests: no network, no provider. */
import { simulateReadableStream } from 'ai';
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

/** One chunk of a mocked model stream, as the mock model's own type says. */
type StreamPart =
  Awaited<ReturnType<MockLanguageModelV4['doStream']>>['stream'] extends ReadableStream<infer Part>
    ? Part
    : never;

/**
 * The stream chunks of a scripted answer.
 *
 * @param step - The answer: text, or a tool call.
 * @param index - Its position, for default ids.
 * @returns The chunks, ending with the finish chunk.
 */
function chunksOf(step: ScriptedStep, index: number): StreamPart[] {
  if ('text' in step) {
    const id = `text-${index}`;
    return [
      { type: 'text-start' as const, id },
      { type: 'text-delta' as const, id, delta: step.text },
      { type: 'text-end' as const, id },
      {
        type: 'finish' as const,
        finishReason: { unified: 'stop' as const, raw: undefined },
        usage,
      },
    ];
  }
  const toolCallId = step.id ?? `call-${index}`;
  const input = JSON.stringify(step.input);
  // Streamed as real providers do: the input in parts, then the call.
  return [
    { type: 'tool-input-start' as const, id: toolCallId, toolName: step.tool },
    { type: 'tool-input-delta' as const, id: toolCallId, delta: input },
    { type: 'tool-input-end' as const, id: toolCallId },
    { type: 'tool-call' as const, toolCallId, toolName: step.tool, input },
    {
      type: 'finish' as const,
      finishReason: { unified: 'tool-calls' as const, raw: undefined },
      usage,
    },
  ];
}

/**
 * A model that answers `streamText` steps from a script, one answer per step.
 *
 * @param steps - The answers, in order.
 * @returns The model.
 */
export function scriptedStreamModel(...steps: ScriptedStep[]): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: steps.map((step, index) => ({
      stream: simulateReadableStream({ chunks: chunksOf(step, index) }),
    })),
  });
}
