/**
 * Builds the services of the settings sections an admin edits: the model gateway, the query
 * builders, the chart recipes, the external hosts and the bin's retention.
 */
import type { AuditRepository } from './db/audit-repository.ts';
import type { SecretBox } from './secrets/secret-box.ts';
import { type ChartSettingsService, createChartSettings } from './settings/chart-settings.ts';
import { createExternalHosts, type ExternalHostsService } from './settings/external-hosts.ts';
import { createModelSettings, type ModelSettingsService } from './settings/model-settings.ts';
import { createQuerySettings, type QuerySettingsService } from './settings/query-settings.ts';
import {
  createRetentionSettings,
  type RetentionSettingsService,
} from './settings/retention-settings.ts';
import type { SettingsStore } from './settings/settings-store.ts';
import type { Usage } from './usage/usage.ts';

/** The settings sections' services. */
export interface SettingsServices {
  /** The model gateway settings. */
  readonly modelSettings: ModelSettingsService;
  /** The query settings. */
  readonly querySettings: QuerySettingsService;
  /** The chart settings. */
  readonly chartSettings: ChartSettingsService;
  /** Where dashboards may link and load images from. */
  readonly externalHosts: ExternalHostsService;
  /** How long deleted threads stay in the bin. */
  readonly retention: RetentionSettingsService;
}

/** What the settings sections need. */
export interface SettingsServiceDependencies {
  /** The settings store. */
  readonly settings: SettingsStore;
  /** Seals the model keys. */
  readonly secretBox: SecretBox;
}

/**
 * Builds the settings sections' services.
 *
 * @param dependencies - The settings store and the secret box.
 * @param audit - The audit log.
 * @param usage - The usage ledger, for the model settings' monthly view.
 * @returns The services.
 */
export function createSettingsServices(
  dependencies: SettingsServiceDependencies,
  audit: AuditRepository,
  usage: Usage,
): SettingsServices {
  const store = dependencies.settings;
  return {
    modelSettings: createModelSettings({
      store,
      secretBox: dependencies.secretBox,
      audit,
      usage: () => usage.month(),
    }),
    querySettings: createQuerySettings({ store, audit }),
    chartSettings: createChartSettings({ store, audit }),
    externalHosts: createExternalHosts({ store, audit }),
    retention: createRetentionSettings({ store, audit }),
  };
}
