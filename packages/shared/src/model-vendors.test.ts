import { describe, expect, test } from 'bun:test';
import type { ModelProvider } from './model-settings.ts';
import { suggestedProviderName, vendorLabel, vendorOf } from './model-vendors.ts';

/**
 * An OpenAI-compatible provider at a base URL.
 *
 * @param baseUrl - The base URL.
 * @returns The provider's kind and URL.
 */
function compatible(baseUrl: string | null) {
  return { provider: 'openai-compatible' as ModelProvider, baseUrl };
}

describe('vendorOf', () => {
  test.each([
    ['https://generativelanguage.googleapis.com/v1beta/openai', 'gemini'],
    ['https://openrouter.ai/api/v1', 'openrouter'],
    ['https://api.groq.com/openai/v1', 'groq'],
    ['https://api.mistral.ai/v1', 'mistral'],
    ['https://api.deepseek.com/v1', 'deepseek'],
    ['https://api.together.xyz/v1', 'together'],
    ['http://localhost:11434/v1', 'ollama'],
    ['http://gpu-box.lan:11434/v1', 'ollama'],
    ['https://api.openai.com/v1', 'openai'],
  ])('knows %s as %s', (baseUrl, vendor) => {
    expect(vendorOf(compatible(baseUrl))).toBe(vendor as ReturnType<typeof vendorOf>);
  });

  test('falls back to a plain OpenAI-compatible gateway for hosts it does not know', () => {
    expect(vendorOf(compatible('http://localhost:4000/v1'))).toBe('openai-compatible');
    expect(vendorOf(compatible('https://evil-googleapis.com/v1'))).toBe('openai-compatible');
    expect(vendorOf(compatible('not a url'))).toBe('openai-compatible');
  });

  test('names the vendor of the kind when the base URL gives nothing away', () => {
    expect(vendorOf({ provider: 'anthropic', baseUrl: null })).toBe('anthropic');
    expect(vendorOf({ provider: 'mistral', baseUrl: 'https://api.mistral.ai/v1' })).toBe('mistral');
    expect(vendorOf({ provider: 'openai', baseUrl: 'https://proxy.example/v1' })).toBe('openai');
  });
});

describe('vendorLabel', () => {
  test('names each vendor, and nothing for an empty or unknown id', () => {
    expect(vendorLabel('gemini')).toBe('Gemini');
    expect(vendorLabel('openai-compatible')).toBe('OpenAI compatible');
    expect(vendorLabel('')).toBeNull();
    expect(vendorLabel('toString')).toBeNull();
  });
});

describe('suggestedProviderName', () => {
  const gemini = compatible('https://generativelanguage.googleapis.com/v1beta/openai');

  test('proposes the vendor while the name is empty or one quanthea gave', () => {
    expect(suggestedProviderName({ ...gemini, name: '' })).toBe('Gemini');
    expect(suggestedProviderName({ ...gemini, name: 'Anthropic' })).toBe('Gemini');
    expect(suggestedProviderName({ ...gemini, name: 'Provider 3' })).toBe('Gemini');
  });

  test('proposes nothing when the name is the vendor or someone chose it', () => {
    expect(suggestedProviderName({ ...gemini, name: 'Gemini' })).toBeNull();
    expect(suggestedProviderName({ ...gemini, name: 'Team Gemini' })).toBeNull();
  });
});
