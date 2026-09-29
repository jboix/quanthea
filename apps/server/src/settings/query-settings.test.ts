import { describe, expect, test } from 'bun:test';
import { queryBuilders, type SavedQuery } from '@querent/shared';
import type { AuditEntry } from '../db/audit-repository.ts';
import { createQuerySettings } from './query-settings.ts';
import { createSettingsStore } from './settings-store.ts';

const saved: SavedQuery = {
  id: 'queue-depth',
  name: 'Queue depth',
  description: 'Messages waiting.',
  language: 'promql',
  query: 'sum({{metric}})',
  params: [{ name: 'metric', kind: 'metric', description: '' }],
  shape: 'long',
};

/**
 * The service over an in-memory settings repository.
 *
 * @returns The service and the audit entries.
 */
function querySettings() {
  const rows = new Map<string, string>();
  const store = createSettingsStore({
    read: (key) => rows.get(key),
    write: (key, value) => void rows.set(key, value),
  });
  const entries: AuditEntry[] = [];
  const service = createQuerySettings({
    store,
    audit: { append: (entry) => void entries.push(entry) },
  });
  return { service, entries };
}

describe('query settings', () => {
  test('start with every built-in query on and none saved', () => {
    const { service } = querySettings();
    expect(service.get()).toEqual({ disabled: [], saved: [] });
    expect(service.available({ mode: 'default' }).builtIn).toEqual(
      queryBuilders.map((query) => query.id),
    );
  });

  test('give a thread the default set, its chosen set, or none', () => {
    const { service, entries } = querySettings();
    service.save({ disabled: ['top', 'sql-rows'], saved: [saved] }, 'admin-1');
    const byDefault = service.available({ mode: 'default' });
    expect(byDefault.builtIn).not.toContain('top');
    expect(byDefault.saved).toEqual([saved]);
    expect(service.available({ mode: 'chosen', ids: ['top', 'nope'] })).toEqual({
      builtIn: ['top'],
      saved: [],
    });
    expect(service.available({ mode: 'free' })).toEqual({ builtIn: [], saved: [] });
    expect(entries.map((entry) => entry.detail)).toEqual([
      { disabled: ['top', 'sql-rows'], saved: ['queue-depth'] },
    ]);
  });

  test('list every query with whether the default set has it', () => {
    const { service } = querySettings();
    service.save({ disabled: ['top'], saved: [saved] }, 'admin-1');
    const choices = service.choices();
    expect(choices.find((choice) => choice.id === 'top')).toMatchObject({ enabled: false });
    expect(choices.at(-1)).toEqual({
      id: 'queue-depth',
      name: 'Queue depth',
      description: 'Messages waiting.',
      language: 'promql',
      origin: 'saved',
      enabled: true,
    });
  });
});
