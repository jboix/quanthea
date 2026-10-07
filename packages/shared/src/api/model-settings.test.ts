import { describe, expect, test } from 'bun:test';
import { listModelsEndpoint } from './model-settings.ts';

describe('listModelsEndpoint', () => {
  test('takes an http or https base URL, or none', () => {
    const body = listModelsEndpoint.body;
    for (const baseUrl of ['https://gw.test/v1', 'http://localhost:11434/v1', null])
      expect(body?.safeParse({ provider: 'openai-compatible', baseUrl }).success).toBe(true);
    for (const baseUrl of ['file:///etc/passwd', 'gopher://gw.test', 'not a url'])
      expect(body?.safeParse({ provider: 'openai-compatible', baseUrl }).success).toBe(false);
  });
});
