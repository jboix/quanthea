/**
 * The model gateway settings: read and saved as a settings section, with the API key sealed in a
 * section of its own and never returned.
 */
import type { ModelSettings, ModelSettingsView } from '@querent/shared';
import type { AuditRepository } from '../db/audit-repository.ts';
import { maskSecret } from '../secrets/mask.ts';
import type { SecretBox } from '../secrets/secret-box.ts';
import type { SettingsStore } from './settings-store.ts';

/** The owner the API key is sealed for, so the sealed value cannot be moved elsewhere. */
const keyOwner = 'settings.model';

/** The settings and the key, as the agent uses them. */
export interface ResolvedModelSettings {
  /** The settings. */
  readonly settings: ModelSettings;
  /** The API key, or `null` when none is stored. */
  readonly apiKey: string | null;
}

/** What the model settings need. */
export interface ModelSettingsDependencies {
  /** The settings store. */
  readonly store: SettingsStore;
  /** Seals the API key. */
  readonly secretBox: SecretBox;
  /** Records who changed the settings. */
  readonly audit: AuditRepository;
  /** The tokens and threads spent this month. */
  readonly usage: () => ModelSettingsView['usage'];
}

/** The model settings. */
export interface ModelSettingsService {
  /**
   * Reads the settings for the admin screen.
   *
   * @returns The settings, the masked key and this month's usage.
   */
  view(): Promise<ModelSettingsView>;
  /**
   * Saves the settings.
   *
   * @param settings - The new settings.
   * @param apiKey - A new API key, or `undefined` to keep the stored one.
   * @param actor - Who saves them.
   * @returns The saved view.
   */
  save(
    settings: ModelSettings,
    apiKey: string | undefined,
    actor: string,
  ): Promise<ModelSettingsView>;
  /**
   * The settings with the key opened, for the agent and the connection test.
   *
   * @returns The settings and the key.
   */
  resolve(): Promise<ResolvedModelSettings>;
}

/**
 * Encodes sealed bytes for the settings store.
 *
 * @param bytes - The sealed bytes.
 * @returns Base64.
 */
function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

/**
 * Creates the service.
 *
 * @param dependencies - The store, the secret box, the audit log and the usage reader.
 * @returns The service.
 */
export function createModelSettings(dependencies: ModelSettingsDependencies): ModelSettingsService {
  const { store, secretBox, audit, usage } = dependencies;
  const resolve = async (): Promise<ResolvedModelSettings> => {
    const { sealed } = store.read('model-key');
    const apiKey =
      sealed === null ? null : await secretBox.open(Buffer.from(sealed, 'base64'), keyOwner);
    return { settings: store.read('model'), apiKey };
  };
  const view = async (): Promise<ModelSettingsView> => {
    const { settings, apiKey } = await resolve();
    return { settings, apiKey: apiKey === null ? null : maskSecret(apiKey), usage: usage() };
  };
  return {
    view,
    resolve,
    async save(settings, apiKey, actor) {
      store.write('model', settings);
      if (apiKey !== undefined)
        store.write('model-key', { sealed: toBase64(await secretBox.seal(apiKey, keyOwner)) });
      const detail = { provider: settings.provider, keyChanged: apiKey !== undefined };
      audit.append({ actor, action: 'settings.model', detail });
      return view();
    },
  };
}
