import { describe, expect, test } from 'bun:test';
import { convertToModelMessages, type ModelMessage, type UIMessage } from 'ai';
import { unansweredCallError, withAnsweredCalls } from './unanswered-calls.ts';

/** An answer whose stream ended after the model called a tool, before the tool returned. */
const cutShort = {
  id: 'a1',
  role: 'assistant',
  parts: [
    { type: 'step-start' },
    {
      type: 'tool-read_guide',
      toolCallId: 'call_1',
      state: 'output-available',
      input: { topic: 'panels' },
      output: 'the guide',
    },
    { type: 'step-start' },
    {
      type: 'tool-chart_recipe',
      toolCallId: 'call_2',
      state: 'input-available',
      input: { recipe: 'line' },
    },
  ],
} as unknown as UIMessage;

/**
 * The tool calls of model messages that no tool result answers, which `streamText` refuses.
 *
 * @param messages - The model messages.
 * @returns The ids of the calls with no result.
 */
function unansweredIds(messages: readonly ModelMessage[]): string[] {
  const parts = messages.flatMap((message) =>
    Array.isArray(message.content)
      ? (message.content as { type: string; toolCallId?: string }[])
      : [],
  );
  const answered = new Set(
    parts.filter((part) => part.type === 'tool-result').map((part) => part.toolCallId),
  );
  return parts
    .filter((part) => part.type === 'tool-call' && !answered.has(part.toolCallId))
    .map((part) => String(part.toolCallId));
}

describe('unanswered calls', () => {
  test('close a call with no result as a failed call, and keep the rest', () => {
    const [message] = withAnsweredCalls([cutShort]);
    expect(message?.parts[1]).toBe(cutShort.parts[1]);
    expect(message?.parts[3]).toEqual({
      type: 'tool-chart_recipe',
      toolCallId: 'call_2',
      state: 'output-error',
      input: { recipe: 'line' },
      errorText: unansweredCallError,
    });
  });

  test('give every call of the converted conversation a result, as the AI SDK demands', async () => {
    const user = { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Build it.' }] };
    const history = [user as UIMessage, cutShort];
    expect(unansweredIds(await convertToModelMessages(history))).toEqual(['call_2']);
    const converted = await convertToModelMessages(withAnsweredCalls(history));
    expect(unansweredIds(converted)).toEqual([]);
    expect(JSON.stringify(converted)).toContain(unansweredCallError);
  });

  test('return the same message when every call has its result', () => {
    const user = { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Hi.' }] };
    const messages = [user];
    expect(withAnsweredCalls(messages)[0]).toBe(user);
  });
});
