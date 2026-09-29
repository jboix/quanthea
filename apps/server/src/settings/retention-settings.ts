/** The retention settings: how many days a deleted thread stays in the bin, 30 by default. */
import type { RetentionSettings } from '@querent/shared';
import type { AuditRepository } from '../db/audit-repository.ts';
import type { SettingsStore } from './settings-store.ts';

/** The retention settings. */
export interface RetentionSettingsService {
  /**
   * The settings.
   *
   * @returns The days a binned thread is kept; `null` until someone deletes it.
   */
  get(): RetentionSettings;
  /**
   * Saves the settings.
   *
   * @param settings - The settings.
   * @param actor - Who saves.
   * @returns The saved settings.
   */
  save(settings: RetentionSettings, actor: string): RetentionSettings;
}

/** What the retention settings need. */
export interface RetentionSettingsDependencies {
  /** The settings store. */
  readonly store: SettingsStore;
  /** Records who changed the settings. */
  readonly audit: AuditRepository;
}

/**
 * Creates the retention settings service.
 *
 * @param dependencies - The store and the audit log.
 * @returns The service.
 */
export function createRetentionSettings(
  dependencies: RetentionSettingsDependencies,
): RetentionSettingsService {
  const { store, audit } = dependencies;
  return {
    get: () => store.read('retention'),
    save(settings, actor) {
      store.write('retention', settings);
      audit.append({ actor, action: 'settings.retention', detail: settings });
      return store.read('retention');
    },
  };
}
