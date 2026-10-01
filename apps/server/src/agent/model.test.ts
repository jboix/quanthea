import { describe, expect, test } from 'bun:test';
import { defaultModelSettings, type ModelSettings } from '@quanthea/shared';
import { reasoningFor } from './model.ts';

/**
 * The default settings with another provider and reasoning switch.
 *
 * @param provider - The provider.
 * @param shortReasoning - Whether reasoning is kept short.
 * @returns The settings.
 */
function settingsFor(provider: ModelSettings['provider'], shortReasoning = true): ModelSettings {
  return {
    ...defaultModelSettings,
    provider,
    behaviour: { ...defaultModelSettings.behaviour, shortReasoning },
  };
}

describe('reasoningFor', () => {
  test('keeps Anthropic from thinking, and asks OpenAI and gateways for a low effort', () => {
    expect(reasoningFor(settingsFor('anthropic'))).toBe('none');
    expect(reasoningFor(settingsFor('openai'))).toBe('low');
    expect(reasoningFor(settingsFor('openai-compatible'))).toBe('low');
  });

  test('leaves Mistral alone, and every provider when the switch is off', () => {
    expect(reasoningFor(settingsFor('mistral'))).toBeUndefined();
    expect(reasoningFor(settingsFor('openai', false))).toBeUndefined();
  });
});
