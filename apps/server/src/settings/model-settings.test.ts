import { describe, expect, test } from 'bun:test';
import { defaultModelGateway, defaultModelSettings, type ModelGateway } from '@querent/shared';
import type { AuditEntry } from '../db/audit-repository.ts';
import { testSecretBox } from '../test/fixtures.ts';
import { createModelSettings } from './model-settings.ts';
import { createSettingsStore } from './settings-store.ts';

const apiKey = 'sk-ant-a-long-key-that-must-never-leak-9f2a';
const usage = { tokens: 1200, threads: 2, pinnedViews: 3, dollars: 0.01 };

/**
 * The service over an in-memory settings repository.
 *
 * @param rows - Rows already stored, if any.
 * @returns The service, the stored rows, the audit entries and the secret box.
 */
async function modelSettings(rows = new Map<string, string>()) {
  const store = createSettingsStore({
    read: (key) => rows.get(key),
    write: (key, value) => void rows.set(key, value),
  });
  const secretBox = await testSecretBox();
  const entries: AuditEntry[] = [];
  const service = createModelSettings({
    store,
    secretBox,
    audit: { append: (entry) => void entries.push(entry) },
    usage: () => usage,
  });
  return { service, rows, entries, secretBox };
}

/** A gateway with a second provider, Mistral, as the default. */
const twoProviders: ModelGateway = {
  ...defaultModelGateway,
  providers: [
    ...defaultModelGateway.providers,
    {
      id: 'mistral-free',
      name: 'Mistral free',
      provider: 'mistral',
      baseUrl: null,
      models: { plan: '', build: 'mistral-large-latest', repair: '', metadata: '' },
    },
  ],
  defaultProviderId: 'mistral-free',
};

describe('model settings', () => {
  test('start from one Anthropic provider with no key', async () => {
    const { service } = await modelSettings();
    expect(await service.view()).toEqual({
      gateway: defaultModelGateway,
      keys: { anthropic: null },
      usage,
    });
    expect(await service.resolve()).toEqual({
      settings: defaultModelSettings,
      apiKey: null,
      providerId: 'anthropic',
      providerName: 'Anthropic',
    });
  });

  test('keep a sealed key per provider, masked, and resolve a thread’s provider', async () => {
    const { service, rows, entries } = await modelSettings();
    const saved = await service.save(twoProviders, { 'mistral-free': apiKey }, 'admin-1');
    expect(saved.keys).toEqual({ anthropic: null, 'mistral-free': '••••••••9f2a' });
    expect([...rows.values()].join('')).not.toContain(apiKey);
    expect(await service.resolve()).toMatchObject({
      settings: { provider: 'mistral', models: { build: 'mistral-large-latest' } },
      apiKey,
      providerName: 'Mistral free',
    });
    expect(await service.resolve('anthropic')).toMatchObject({
      apiKey: null,
      providerId: 'anthropic',
    });
    expect(await service.resolve('removed')).toMatchObject({ providerId: 'mistral-free' });
    expect(entries.map((entry) => entry.detail)).toEqual([
      { providers: 2, keysChanged: ['mistral-free'] },
    ]);
  });

  test('drop a removed provider’s key', async () => {
    const { service } = await modelSettings();
    await service.save(twoProviders, { 'mistral-free': apiKey }, 'admin-1');
    const back = { ...defaultModelGateway };
    expect((await service.save(back, {}, 'admin-1')).keys).toEqual({ anthropic: null });
    expect((await service.save(twoProviders, {}, 'admin-1')).keys['mistral-free']).toBeNull();
  });
});
