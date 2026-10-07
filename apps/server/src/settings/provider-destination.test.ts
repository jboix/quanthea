import { describe, expect, test } from 'bun:test';
import { storedKeyApplies } from './provider-destination.ts';

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
