/**
 * The API access settings: whether the MCP endpoint answers and with which tools, and how long a
 * new API token may last.
 */
import type { ApiAccessSettings } from '@quanthea/shared';
import type { AuditRepository } from '../db/audit-repository.ts';
import type { SettingsStore } from './settings-store.ts';

/** The API access settings. */
export interface ApiAccessSettingsService {
  /**
   * The settings.
   *
   * @returns Whether the MCP endpoint answers, its tools, and the longest a new token may last.
   */
  get(): ApiAccessSettings;
  /**
   * Saves the settings.
   *
   * @param settings - The settings.
   * @param actor - Who saves.
   * @returns The saved settings.
   */
  save(settings: ApiAccessSettings, actor: string): ApiAccessSettings;
}

/** What the API access settings need. */
export interface ApiAccessSettingsDependencies {
  /** The settings store. */
  readonly store: SettingsStore;
  /** Records who changed the settings. */
  readonly audit: AuditRepository;
}

/**
 * Creates the API access settings service.
 *
 * @param dependencies - The store and the audit log.
 * @returns The service.
 */
export function createApiAccessSettings(
  dependencies: ApiAccessSettingsDependencies,
): ApiAccessSettingsService {
  const { store, audit } = dependencies;
  return {
    get: () => store.read('api-access'),
    save(settings, actor) {
      store.write('api-access', settings);
      audit.append({ actor, action: 'settings.api-access', detail: settings });
      return store.read('api-access');
    },
  };
}
