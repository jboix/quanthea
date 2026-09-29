import { describe, expect, test } from 'bun:test';
import { chartRecipes } from '@querent/shared';
import type { AuditEntry } from '../db/audit-repository.ts';
import { createChartSettings } from './chart-settings.ts';
import { createSettingsStore } from './settings-store.ts';

/**
 * The service over an in-memory settings repository.
 *
 * @returns The service and the audit entries.
 */
function chartSettings() {
  const rows = new Map<string, string>();
  const store = createSettingsStore({
    read: (key) => rows.get(key),
    write: (key, value) => void rows.set(key, value),
  });
  const entries: AuditEntry[] = [];
  const service = createChartSettings({
    store,
    audit: { append: (entry) => void entries.push(entry) },
  });
  return { service, entries };
}

describe('chart settings', () => {
  test('offer every recipe until one is switched off', () => {
    const { service, entries } = chartSettings();
    expect(service.enabled()).toHaveLength(chartRecipes.length);
    service.save({ disabled: ['geo.choropleth', 'flow.graph'] }, 'admin-1');
    expect(service.enabled()).not.toContain('geo.choropleth');
    expect(service.enabled()).toHaveLength(chartRecipes.length - 2);
    expect(entries.map((entry) => entry.detail)).toEqual([
      { disabled: ['geo.choropleth', 'flow.graph'] },
    ]);
  });

  test('keep at least one recipe on', () => {
    const { service } = chartSettings();
    const all = chartRecipes.map((recipe) => recipe.id);
    expect(() => service.save({ disabled: all }, 'admin-1')).toThrow(
      'Keep at least one chart recipe on.',
    );
  });
});
