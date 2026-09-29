/**
 * The chart settings: which chart recipes the agent is offered. Every recipe is on until an admin
 * switches it off, and at least one stays on.
 */
import { type ChartSettings, chartRecipes } from '@querent/shared';
import type { AuditRepository } from '../db/audit-repository.ts';
import { AppError } from '../lib/errors.ts';
import type { SettingsStore } from './settings-store.ts';

/** The chart settings. */
export interface ChartSettingsService {
  /**
   * The settings.
   *
   * @returns The recipes switched off.
   */
  get(): ChartSettings;
  /**
   * Saves the settings.
   *
   * @param settings - The settings.
   * @param actor - Who saves.
   * @returns The saved settings.
   * @throws {AppError} `bad_request` when every recipe would be off.
   */
  save(settings: ChartSettings, actor: string): ChartSettings;
  /**
   * The recipes the agent is offered.
   *
   * @returns Their ids, in catalogue order.
   */
  enabled(): string[];
}

/** What the chart settings need. */
export interface ChartSettingsDependencies {
  /** The settings store. */
  readonly store: SettingsStore;
  /** Records who changed the settings. */
  readonly audit: AuditRepository;
}

/**
 * The ids of the recipes left on.
 *
 * @param settings - The settings.
 * @returns The ids.
 */
function enabledIds(settings: ChartSettings): string[] {
  return chartRecipes.map((recipe) => recipe.id).filter((id) => !settings.disabled.includes(id));
}

/**
 * Creates the chart settings service.
 *
 * @param dependencies - The store and the audit log.
 * @returns The service.
 */
export function createChartSettings(dependencies: ChartSettingsDependencies): ChartSettingsService {
  const { store, audit } = dependencies;
  return {
    get: () => store.read('charts'),
    save(settings, actor) {
      if (enabledIds(settings).length === 0)
        throw new AppError('bad_request', 'Keep at least one chart recipe on.');
      store.write('charts', settings);
      audit.append({ actor, action: 'settings.charts', detail: { disabled: settings.disabled } });
      return store.read('charts');
    },
    enabled: () => enabledIds(store.read('charts')),
  };
}
