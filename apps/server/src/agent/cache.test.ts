import { describe, expect, test } from 'bun:test';
import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText, type ModelMessage } from 'ai';
import { cachedInstructions, withCachedTail } from './cache.ts';

const parts = { lasting: 'Who you are, the rules and the catalog.', turn: 'Current time: now.' };

const conversation: ModelMessage[] = [
  { role: 'user', content: 'What happened yesterday?' },
  { role: 'assistant', content: 'Which errors?' },
  { role: 'user', content: [{ type: 'text', text: 'HTTP 5xx' }] },
];

/**
 * The body Anthropic would receive for the instructions and messages, read from a fake fetch that
 * fails once it has seen the request.
 *
 * @param messages - The messages.
 * @returns The request body.
 */
async function anthropicBody(messages: ModelMessage[]): Promise<Record<string, unknown>> {
  let body: Record<string, unknown> = {};
  const fetch = (async (_url: string, init: RequestInit) => {
    body = JSON.parse(String(init.body));
    throw new Error('stop here');
  }) as unknown as typeof globalThis.fetch;
  const model = createAnthropic({ apiKey: 'test', fetch })('claude-sonnet-5');
  const instructions = cachedInstructions(parts, 'anthropic');
  await generateText({ model, instructions, messages, maxRetries: 0 }).catch(() => undefined);
  return body;
}

describe('prompt caching for Anthropic', () => {
  test('marks the lasting instructions and the end of the conversation as cache points', async () => {
    const body = await anthropicBody(withCachedTail(conversation, 'anthropic'));
    expect(body.system).toEqual([
      { type: 'text', text: parts.lasting, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: parts.turn },
    ]);
    const messages = body.messages as { content: { cache_control?: unknown }[] }[];
    const marks = messages.flatMap((message) =>
      message.content.filter((part) => part.cache_control !== undefined),
    );
    expect(marks).toHaveLength(1);
    expect(messages.at(-1)?.content.at(-1)?.cache_control).toEqual({ type: 'ephemeral' });
  });

  test('keeps one cache point in the conversation, step after step', () => {
    const first = withCachedTail(conversation, 'anthropic');
    const next = withCachedTail(
      [...first, { role: 'assistant', content: 'Here it is.' }],
      'anthropic',
    );
    const marked = next.filter((message) => message.providerOptions?.anthropic !== undefined);
    expect(marked).toEqual(next.slice(-1));
  });
});

describe('prompt caching for the other providers', () => {
  test('sends one text, lasting part first, and leaves the messages alone', () => {
    expect(cachedInstructions(parts, 'openai-compatible')).toBe(
      `${parts.lasting}\n\n${parts.turn}`,
    );
    expect(withCachedTail(conversation, 'mistral')).toEqual(conversation);
  });
});
