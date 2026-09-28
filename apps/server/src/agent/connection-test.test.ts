import { describe, expect, test } from 'bun:test';
import { defaultModelSettings } from '@querent/shared';
import { testModelConnection } from './connection-test.ts';
import { languageModel, ModelUnavailableError, modelIdFor } from './model.ts';
import { scriptedModel } from './test/mock-model.ts';

const resolved = { settings: defaultModelSettings, apiKey: 'sk-test' };

describe('testModelConnection', () => {
  test('reports tool calling and structured output', async () => {
    const model = scriptedModel({ tool: 'ping', input: { value: 42 } }, { text: '{"ok":true}' });
    const result = await testModelConnection(resolved, () => model);
    expect(result).toMatchObject({
      ok: true,
      toolCalling: true,
      structuredOutput: true,
      message: 'claude-sonnet-5',
    });
  });

  test('reports a model that ignores tools and answers in prose', async () => {
    const model = scriptedModel({ text: 'Pong.' }, { text: 'Sure thing!' });
    const result = await testModelConnection(resolved, () => model);
    expect(result).toMatchObject({ ok: true, toolCalling: false, structuredOutput: false });
  });

  test('reports a gateway it cannot build or reach', async () => {
    const result = await testModelConnection({ ...resolved, apiKey: null });
    expect(result).toMatchObject({
      ok: false,
      message: 'Not reachable: Save an API key in Settings → Model first.',
    });
  });
});

describe('languageModel', () => {
  test('needs a key for Anthropic and OpenAI, not for a compatible gateway', () => {
    expect(() => languageModel({ ...resolved, apiKey: null }, 'build')).toThrow(
      ModelUnavailableError,
    );
    const gateway = {
      ...defaultModelSettings,
      provider: 'openai-compatible' as const,
      baseUrl: 'http://localhost:4000/v1',
    };
    expect(languageModel({ settings: gateway, apiKey: null }, 'build')).toBeDefined();
  });

  test('uses the build model when a job has none of its own', () => {
    expect(modelIdFor(defaultModelSettings, 'repair')).toBe('claude-sonnet-5');
    expect(modelIdFor(defaultModelSettings, 'metadata')).toBe('claude-haiku-4-5');
  });
});
