/**
 * The report settings: how many times a failed run tries again (2 by default) and after how long
 * (15 minutes), and how many days runs are kept (for good by default).
 */
import type { ReportSettings } from '@quanthea/shared';
import type { AuditRepository } from '../db/audit-repository.ts';
import type { SettingsStore } from './settings-store.ts';

/** The report settings. */
export interface ReportSettingsService {
  /**
   * The settings.
   *
   * @returns The retries, their delay and the days runs are kept.
   */
  get(): ReportSettings;
  /**
   * Saves the settings. A run waiting to try again keeps the time it was given.
   *
   * @param settings - The settings.
   * @param actor - Who saves.
   * @returns The saved settings.
   */
  save(settings: ReportSettings, actor: string): ReportSettings;
}

/**
 * Creates the report settings service.
 *
 * @param dependencies - The store and the audit log.
 * @param dependencies.store - The settings store.
 * @param dependencies.audit - Records who changed the settings.
 * @returns The service.
 */
export function createReportSettings(dependencies: {
  readonly store: SettingsStore;
  readonly audit: AuditRepository;
}): ReportSettingsService {
  const { store, audit } = dependencies;
  return {
    get: () => store.read('reports'),
    save(settings, actor) {
      store.write('reports', settings);
      audit.append({ actor, action: 'settings.reports', detail: settings });
      return store.read('reports');
    },
  };
}
