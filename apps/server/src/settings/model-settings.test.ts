import { describe, expect, test } from 'bun:test';
import { defaultModelSettings } from '@querent/shared';
import type { AuditEntry } from '../db/audit-repository.ts';
import { createSecretBox } from '../secrets/secret-box.ts';
import { createModelSettings } from './model-settings.ts';
import { createSettingsStore } from './settings-store.ts';

const apiKey = 'sk-ant-a-long-key-that-must-never-leak-9f2a';

/**
 * The service over an in-memory settings repository.
 *
 * @returns The service, the stored rows and the audit entries.
 */
async function modelSettings() {
  const rows = new Map<string, string>();
  const store = createSettingsStore({
    read: (key) => rows.get(key),
    write: (key, value) => void rows.set(key, value),
  });
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  const entries: AuditEntry[] = [];
  const service = createModelSettings({
    store,
    secretBox: createSecretBox(key),
    audit: { append: (entry) => void entries.push(entry) },
    usage: () => ({ tokens: 1200, threads: 2, pinnedViews: 3, dollars: 0.01 }),
  });
  return { service, rows, entries };
}

describe('model settings', () => {
  test('start from the defaults with no key', async () => {
    const { service } = await modelSettings();
    expect(await service.view()).toEqual({
      settings: defaultModelSettings,
      apiKey: null,
      usage: { tokens: 1200, threads: 2, pinnedViews: 3, dollars: 0.01 },
    });
    expect(await service.resolve()).toEqual({ settings: defaultModelSettings, apiKey: null });
  });

  test('seal the key, return it masked, and keep it when a save leaves it out', async () => {
    const { service, rows, entries } = await modelSettings();
    const saved = await service.save(defaultModelSettings, apiKey, 'admin-1');
    expect(saved.apiKey).toBe('••••••••9f2a');
    expect([...rows.values()].join('')).not.toContain(apiKey);
    const changed = { ...defaultModelSettings, provider: 'openai' as const };
    expect((await service.save(changed, undefined, 'admin-1')).apiKey).toBe('••••••••9f2a');
    expect(await service.resolve()).toEqual({ settings: changed, apiKey });
    expect(entries.map((entry) => entry.detail)).toEqual([
      { provider: 'anthropic', keyChanged: true },
      { provider: 'openai', keyChanged: false },
    ]);
  });
});
