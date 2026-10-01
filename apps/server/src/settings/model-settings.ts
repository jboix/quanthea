/**
 * The model gateway settings: the saved providers, the default one, the limits and the behaviour.
 * Each provider's API key is sealed for that provider and never returned, only masked.
 */
import {
  type ModelGateway,
  type ModelSettings,
  type ModelSettingsView,
  providerFor,
  settingsFor,
} from '@querent/shared';
import type { AuditRepository } from '../db/audit-repository.ts';
import { maskSecret } from '../secrets/mask.ts';
import type { SecretBox } from '../secrets/secret-box.ts';
import type { SettingsStore } from './settings-store.ts';

/**
 * The owner a provider's key is sealed for, so a sealed key cannot move to another provider.
 *
 * @param providerId - The provider.
 * @returns The owner.
 */
function ownerOf(providerId: string): string {
  return `settings.model.${providerId}`;
}

/** The settings and the key a run uses. */
export interface ResolvedModelSettings {
  /** The provider's settings, with the shared limits and behaviour. */
  readonly settings: ModelSettings;
  /** The provider's API key, or `null` when none is stored. */
  readonly apiKey: string | null;
  /** The provider's id. */
  readonly providerId: string;
  /** The provider's name. */
  readonly providerName: string;
}

/** What the model settings need. */
export interface ModelSettingsDependencies {
  /** The settings store. */
  readonly store: SettingsStore;
  /** Seals the API keys. */
  readonly secretBox: SecretBox;
  /** Records who changed the settings. */
  readonly audit: AuditRepository;
  /** This month's usage, from the ledger. */
  readonly usage: () => ModelSettingsView['usage'];
}

/** The model settings. */
export interface ModelSettingsService {
  /**
   * The settings as an admin sees them: each key masked.
   *
   * @returns The gateway, the masked keys and this month's usage.
   */
  view(): Promise<ModelSettingsView>;
  /**
   * Saves the gateway and any new keys. The keys of removed providers go with them.
   *
   * @param gateway - The gateway.
   * @param apiKeys - New keys by provider id.
   * @param actor - Who saves.
   * @returns The saved view.
   */
  save(
    gateway: ModelGateway,
    apiKeys: Readonly<Record<string, string>>,
    actor: string,
  ): Promise<ModelSettingsView>;
  /**
   * The settings and key of a provider: the one named, or the default.
   *
   * @param providerId - The provider, if any.
   * @returns The resolved settings.
   */
  resolve(providerId?: string | null): Promise<ResolvedModelSettings>;
  /**
   * The saved gateway, keys aside.
   *
   * @returns The gateway.
   */
  gateway(): ModelGateway;
}

/**
 * Encodes bytes as base64.
 *
 * @param bytes - The bytes.
 * @returns The base64 text.
 */
function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

/**
 * Seals the providers' API keys again with the current key, after a key rotation.
 *
 * @param dependencies - The store and the secret box.
 * @returns How many keys were sealed again.
 */
export async function resealModelKeys(
  dependencies: Pick<ModelSettingsDependencies, 'store' | 'secretBox'>,
): Promise<number> {
  const { store, secretBox } = dependencies;
  const keys = { ...store.read('model-keys').sealed };
  let count = 0;
  for (const [id, sealed] of Object.entries(keys)) {
    const bytes = Buffer.from(sealed, 'base64');
    if (secretBox.isCurrent(bytes)) continue;
    const key = await secretBox.open(bytes, ownerOf(id));
    keys[id] = toBase64(await secretBox.seal(key, ownerOf(id)));
    count += 1;
  }
  if (count > 0) store.write('model-keys', { sealed: keys });
  return count;
}

/**
 * Opens a provider's key.
 *
 * @param dependencies - The store and the secret box.
 * @param providerId - The provider.
 * @returns The key, or `null` when none is stored.
 */
async function keyOf(dependencies: ModelSettingsDependencies, providerId: string) {
  const sealed = dependencies.store.read('model-keys').sealed[providerId];
  if (sealed === undefined) return null;
  return dependencies.secretBox.open(Buffer.from(sealed, 'base64'), ownerOf(providerId));
}

/**
 * The keys after a save: new ones sealed, removed providers' dropped, the others kept.
 *
 * @param dependencies - The store and the secret box.
 * @param gateway - The saved gateway.
 * @param apiKeys - New keys by provider id.
 * @returns The sealed keys by provider id.
 */
async function savedKeys(
  dependencies: ModelSettingsDependencies,
  gateway: ModelGateway,
  apiKeys: Readonly<Record<string, string>>,
): Promise<Record<string, string>> {
  const before = dependencies.store.read('model-keys').sealed;
  const keys: Record<string, string> = {};
  for (const { id } of gateway.providers) {
    const typed = apiKeys[id];
    const sealed = typed
      ? toBase64(await dependencies.secretBox.seal(typed, ownerOf(id)))
      : before[id];
    if (sealed !== undefined) keys[id] = sealed;
  }
  return keys;
}

/**
 * The settings as an admin sees them.
 *
 * @param dependencies - The store, the secret box and the usage.
 * @returns The view.
 */
async function viewOf(dependencies: ModelSettingsDependencies): Promise<ModelSettingsView> {
  const gateway = dependencies.store.read('model');
  const keys: Record<string, string | null> = {};
  for (const { id } of gateway.providers) {
    const key = await keyOf(dependencies, id);
    keys[id] = key === null ? null : maskSecret(key);
  }
  return { gateway, keys, usage: dependencies.usage() };
}

/**
 * Creates the model settings service.
 *
 * @param dependencies - The store, the secret box, the audit log and the usage reader.
 * @returns The service.
 */
export function createModelSettings(dependencies: ModelSettingsDependencies): ModelSettingsService {
  const { store, audit } = dependencies;
  return {
    view: () => viewOf(dependencies),
    gateway: () => store.read('model'),
    async resolve(providerId) {
      const gateway = store.read('model');
      const config = providerFor(gateway, providerId);
      const apiKey = await keyOf(dependencies, config.id);
      const settings = settingsFor(gateway, config.id);
      return { settings, apiKey, providerId: config.id, providerName: config.name };
    },
    async save(gateway, apiKeys, actor) {
      const keys = await savedKeys(dependencies, gateway, apiKeys);
      store.write('model', gateway);
      store.write('model-keys', { sealed: keys });
      const detail = { providers: gateway.providers.length, keysChanged: Object.keys(apiKeys) };
      audit.append({ actor, action: 'settings.model', detail });
      return viewOf(dependencies);
    },
  };
}
