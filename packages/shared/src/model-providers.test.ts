import { describe, expect, test } from 'bun:test';
import { gatewayPresets, providerProfiles } from './model-providers.ts';
import { modelPrices } from './model-usage.ts';

/** Every set of starting models: each vendor's own, and each preset's that has some. */
const startingModels = [
  ...Object.entries(providerProfiles).map(([name, profile]) => [name, profile.defaults] as const),
  ...gatewayPresets.flatMap((preset) =>
    preset.defaults ? [[preset.name, preset.defaults] as const] : [],
  ),
].filter(([, defaults]) => defaults.build !== '');

describe('starting models', () => {
  test.each(startingModels)('%s answers on the model that writes titles', (_name, defaults) => {
    expect(defaults.answer).toBe(defaults.metadata);
  });

  test('the Gemini preset talks on Flash Lite and builds on Flash', () => {
    const gemini = gatewayPresets.find((preset) => preset.name === 'Gemini');
    expect(gemini?.defaults).toEqual({
      plan: 'gemini-3.5-flash-lite',
      build: 'gemini-3.8-flash',
      repair: '',
      metadata: 'gemini-3.5-flash-lite',
      answer: 'gemini-3.5-flash-lite',
    });
  });

  test.each(startingModels)('%s starts on models with a known price', (_name, defaults) => {
    const named = Object.values(defaults).filter((model) => model !== '');
    for (const model of named) expect(Object.hasOwn(modelPrices, model)).toBe(true);
  });
});
