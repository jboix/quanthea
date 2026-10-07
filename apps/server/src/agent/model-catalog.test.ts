import { describe, expect, test } from 'bun:test';
import { listModels, storedKeyApplies } from './model-catalog.ts';

/**
 * A fetch that answers with a body and records the request.
 *
 * @param status - The status.
 * @param body - The JSON body.
 * @returns The fetch and the requests it saw.
 */
function fakeFetch(status: number, body: unknown) {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const fetchFunction = ((url: string, init: RequestInit) => {
    seen.push({ url, headers: init.headers as Record<string, string> });
    return Promise.resolve(Response.json(body, { status }));
  }) as typeof fetch;
  return { fetchFunction, seen };
}

describe('listModels', () => {
  test('lists chat models sorted, without other kinds or the models/ prefix', async () => {
    const { fetchFunction, seen } = fakeFetch(200, {
      data: [
        { id: 'models/gemini-3.5-flash' },
        { id: 'text-embedding-3' },
        { id: 'claude-sonnet-5' },
        { id: 'gpt-image-1' },
      ],
    });
    const catalog = await listModels(
      { provider: 'openai-compatible', baseUrl: 'http://gw/v1/', apiKey: 'k' },
      fetchFunction,
    );
    expect(catalog).toEqual({ ok: true, models: ['claude-sonnet-5', 'gemini-3.5-flash'] });
    expect(seen[0]).toEqual({ url: 'http://gw/v1/models', headers: { Authorization: 'Bearer k' } });
  });

  test('asks each provider its own way', async () => {
    const { fetchFunction, seen } = fakeFetch(200, { data: [] });
    await listModels({ provider: 'anthropic', baseUrl: null, apiKey: 'k' }, fetchFunction);
    await listModels({ provider: 'mistral', baseUrl: null, apiKey: 'k' }, fetchFunction);
    expect(seen.map((request) => request.url)).toEqual([
      'https://api.anthropic.com/v1/models',
      'https://api.mistral.ai/v1/models',
    ]);
    expect(seen[0]?.headers).toEqual({ 'x-api-key': 'k', 'anthropic-version': '2023-06-01' });
  });

  test('says what is missing or what the provider answered', async () => {
    const { fetchFunction } = fakeFetch(401, {});
    expect(
      await listModels({ provider: 'openai', baseUrl: null, apiKey: null }, fetchFunction),
    ).toEqual({
      ok: false,
      message: 'Enter the API key to list every model the provider offers.',
    });
    expect(
      await listModels(
        { provider: 'openai-compatible', baseUrl: null, apiKey: null },
        fetchFunction,
      ),
    ).toMatchObject({ ok: false });
    expect(
      await listModels({ provider: 'openai', baseUrl: null, apiKey: 'bad' }, fetchFunction),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining('401'),
    });
  });
});

describe('storedKeyApplies', () => {
  const saved = {
    providerId: 'p1',
    provider: 'openai-compatible',
    baseUrl: 'https://gw.test/v1',
  } as const;

  test('applies to the saved provider, vendor and base URL, however the URL is written', () => {
    const request = {
      providerId: 'p1',
      provider: 'openai-compatible',
      baseUrl: 'https://GW.test/v1/',
    } as const;
    expect(storedKeyApplies(request, saved)).toBe(true);
    const openai = { providerId: 'p2', provider: 'openai', baseUrl: null } as const;
    expect(storedKeyApplies({ ...openai, baseUrl: 'https://api.openai.com/v1' }, openai)).toBe(
      true,
    );
  });

  test('never applies to another base URL, vendor or provider', () => {
    const request = {
      providerId: 'p1',
      provider: 'openai-compatible',
      baseUrl: 'https://attacker.example',
    } as const;
    expect(storedKeyApplies(request, saved)).toBe(false);
    expect(storedKeyApplies({ ...saved, provider: 'openai' }, saved)).toBe(false);
    expect(storedKeyApplies({ ...saved, providerId: 'p2' }, saved)).toBe(false);
    expect(storedKeyApplies({ ...saved, providerId: undefined }, saved)).toBe(false);
  });
});
