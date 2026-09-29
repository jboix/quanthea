import { describe, expect, test } from 'bun:test';
import { builtInRecipes, type SavedRecipe } from '@querent/shared';
import type { AuditEntry } from '../db/audit-repository.ts';
import { createRecipeSettings } from './recipe-settings.ts';
import { createSettingsStore } from './settings-store.ts';

const saved: SavedRecipe = {
  id: 'queue-depth',
  name: 'Queue depth',
  description: 'Messages waiting.',
  language: 'promql',
  query: 'sum({{metric}})',
  params: [{ name: 'metric', kind: 'metric', description: '' }],
  show: 'line',
  unit: 'number',
};

/**
 * The service over an in-memory settings repository.
 *
 * @returns The service and the audit entries.
 */
function recipeSettings() {
  const rows = new Map<string, string>();
  const store = createSettingsStore({
    read: (key) => rows.get(key),
    write: (key, value) => void rows.set(key, value),
  });
  const entries: AuditEntry[] = [];
  const service = createRecipeSettings({
    store,
    audit: { append: (entry) => void entries.push(entry) },
  });
  return { service, entries };
}

describe('recipe settings', () => {
  test('start with every built-in recipe on and none saved', () => {
    const { service } = recipeSettings();
    expect(service.get()).toEqual({ disabled: [], saved: [] });
    expect(service.available({ mode: 'default' }).builtIn).toEqual(
      builtInRecipes.map((recipe) => recipe.id),
    );
  });

  test('give a thread the default set, its chosen set, or none', () => {
    const { service, entries } = recipeSettings();
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

  test('list every recipe with whether the default set has it', () => {
    const { service } = recipeSettings();
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
