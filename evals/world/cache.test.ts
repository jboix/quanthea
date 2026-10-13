import { describe, expect, test } from 'bun:test';
import type { LanguageModelV4CallOptions } from '@ai-sdk/provider';
import { keyOf } from './cache.ts';

/**
 * A request to a model.
 *
 * @param text - What the person says.
 * @param extra - Settings to add.
 * @returns The request.
 */
function request(text: string, extra: Partial<LanguageModelV4CallOptions> = {}) {
  const prompt = [{ role: 'user', content: [{ type: 'text', text }] }];
  return { prompt, ...extra } as LanguageModelV4CallOptions;
}

const none = new Map<string, string>();

describe('the key of a cached response', () => {
  test('is the same for the same model and request, and another for another', () => {
    const key = keyOf('model-a', request('hello'), none);
    expect(keyOf('model-a', request('hello'), none)).toBe(key);
    expect(keyOf('model-b', request('hello'), none)).not.toBe(key);
    expect(keyOf('model-a', request('goodbye'), none)).not.toBe(key);
  });

  test('holds the settings: another temperature is another request', () => {
    const key = keyOf('model-a', request('hello'), none);
    expect(keyOf('model-a', request('hello', { temperature: 0 }), none)).not.toBe(key);
    expect(keyOf('model-a', request('hello', { maxOutputTokens: 100 }), none)).not.toBe(key);
  });

  test('writes the ids a run made as their aliases, so the next run finds the response', () => {
    const one = keyOf(
      'm',
      request('notify channel-123'),
      new Map([['channel-123', 'the-channel']]),
    );
    const other = keyOf(
      'm',
      request('notify channel-456'),
      new Map([['channel-456', 'the-channel']]),
    );
    expect(one).toBe(other);
  });

  test('the first trial of the unnamed sample set has the key a run without trials has', () => {
    const key = keyOf('model-a', request('hello'), none);
    expect(keyOf('model-a', request('hello'), none, { sample: '', trial: 1 })).toBe(key);
  });

  test('each later trial has a key of its own, which the same trial finds again', () => {
    const first = keyOf('model-a', request('hello'), none, { sample: '', trial: 1 });
    const second = keyOf('model-a', request('hello'), none, { sample: '', trial: 2 });
    const third = keyOf('model-a', request('hello'), none, { sample: '', trial: 3 });
    expect(new Set([first, second, third]).size).toBe(3);
    expect(keyOf('model-a', request('hello'), none, { sample: '', trial: 2 })).toBe(second);
  });

  test('a named sample set shares no key with another: a new name asks for new answers', () => {
    const unnamed = keyOf('model-a', request('hello'), none, { sample: '', trial: 1 });
    const monday = keyOf('model-a', request('hello'), none, { sample: 'monday', trial: 1 });
    const friday = keyOf('model-a', request('hello'), none, { sample: 'friday', trial: 1 });
    expect(new Set([unnamed, monday, friday]).size).toBe(3);
  });
});
