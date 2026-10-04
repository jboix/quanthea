/** The alert settings: how many alerts may be active per connector, 50 by default. */
import type { AlertSettings } from '@quanthea/shared';
import type { AuditRepository } from '../db/audit-repository.ts';
import type { SettingsStore } from './settings-store.ts';

/** The alert settings. */
export interface AlertSettingsService {
  /**
   * The settings.
   *
   * @returns The most alerts active per connector.
   */
  get(): AlertSettings;
  /**
   * Saves the settings. Alerts already active stay active; the cap holds for the next activation.
   *
   * @param settings - The settings.
   * @param actor - Who saves.
   * @returns The saved settings.
   */
  save(settings: AlertSettings, actor: string): AlertSettings;
}

/**
 * Creates the alert settings service.
 *
 * @param dependencies - The store and the audit log.
 * @returns The service.
 */
export function createAlertSettings(dependencies: {
  readonly store: SettingsStore;
  readonly audit: AuditRepository;
}): AlertSettingsService {
  const { store, audit } = dependencies;
  return {
    get: () => store.read('alerts'),
    save(settings, actor) {
      store.write('alerts', settings);
      audit.append({ actor, action: 'settings.alerts', detail: settings });
      return store.read('alerts');
    },
  };
}
