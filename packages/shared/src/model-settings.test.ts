import { describe, expect, test } from 'bun:test';
import { defaultModelGateway, defaultModelSettings, modelGatewaySchema } from './model-settings.ts';

describe('the default model settings', () => {
  test('give a thread a budget of a million tokens', () => {
    expect(defaultModelSettings.limits.threadTokens).toBe(1_000_000);
    expect(defaultModelGateway.limits.threadTokens).toBe(1_000_000);
  });

  test('make a valid gateway', () => {
    expect(modelGatewaySchema.safeParse(defaultModelGateway).success).toBe(true);
  });
});
