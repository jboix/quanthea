/**
 * The model settings form state: the gateway as edited, the provider being edited, and the keys
 * or client secrets typed for providers. The cards read one provider at a time as flat settings, so a field's path
 * is the same whichever provider is selected.
 */
import {
  type ModelGateway,
  type ModelProvider,
  type ModelSettings,
  type ProviderAuth,
  type ProviderConfig,
  providerProfiles,
  settingsFor,
} from '@quanthea/shared';
import { useCallback, useState } from 'react';

/**
 * Sets a value at a dotted path of an object, returning a new object.
 *
 * @param target - The object.
 * @param path - Such as `models.build`.
 * @param value - The new value.
 * @returns The changed object.
 */
function setPath<Target>(target: Target, path: string, value: unknown): Target {
  const [head, ...rest] = path.split('.');
  const key = head ?? '';
  const current = (target as Record<string, unknown>)[key];
  const next = rest.length === 0 ? value : setPath(current, rest.join('.'), value);
  return { ...target, [key]: next } as Target;
}

/**
 * The gateway with every vendor's own API written out, so the form shows where requests go.
 *
 * @param gateway - The gateway.
 * @returns The gateway, each provider with its base URL.
 */
function withProviderUrls(gateway: ModelGateway): ModelGateway {
  const providers = gateway.providers.map((config) =>
    config.baseUrl !== null
      ? config
      : { ...config, baseUrl: providerProfiles[config.provider].baseUrl },
  );
  return { ...gateway, providers };
}

/**
 * Switches a provider's vendor: back to its saved setup for its saved vendor, or to the new
 * vendor's API and starting models.
 *
 * @param current - The provider as edited.
 * @param saved - The provider as saved, if it was.
 * @param provider - The vendor chosen.
 * @returns The provider for that vendor.
 */
function switchVendor(
  current: ProviderConfig,
  saved: ProviderConfig | undefined,
  provider: ModelProvider,
): ProviderConfig {
  if (saved && provider === saved.provider) {
    return { ...current, provider, baseUrl: saved.baseUrl, models: saved.models };
  }
  const profile = providerProfiles[provider];
  // Through an identity provider the base URL is the gateway's, whichever API it speaks.
  const baseUrl = current.auth.type === 'api-key' ? profile.baseUrl : current.baseUrl;
  return { ...current, provider, baseUrl, models: { ...profile.defaults } };
}

/** A provider reached through an identity provider, before its fields are filled in. */
const newIdentity: ProviderAuth = {
  type: 'oauth-client-credentials',
  issuer: null,
  tokenUrl: null,
  clientId: '',
  scope: '',
  audience: '',
};

/**
 * Switches how a provider is reached: back to its saved setup, or to an empty one. Through an
 * identity provider the vendor's own API is cleared, since it takes keys only; with a key an empty
 * base URL goes back to the vendor's own API.
 *
 * @param current - The provider as edited.
 * @param saved - The provider as saved, if it was.
 * @param type - How it is reached.
 * @returns The provider.
 */
function switchConnection(
  current: ProviderConfig,
  saved: ProviderConfig | undefined,
  type: ProviderAuth['type'],
): ProviderConfig {
  const fresh: ProviderAuth = type === 'api-key' ? { type } : newIdentity;
  const auth = saved?.auth.type === type ? saved.auth : fresh;
  const own = providerProfiles[current.provider].baseUrl;
  if (type === 'api-key') return { ...current, auth, baseUrl: current.baseUrl ?? own };
  return { ...current, auth, baseUrl: current.baseUrl === own ? null : current.baseUrl };
}

/**
 * A new provider, with an id no other provider has.
 *
 * @param gateway - The gateway.
 * @returns The provider: Mistral, with its API and starting models.
 */
function newProvider(gateway: ModelGateway): ProviderConfig {
  const taken = new Set(gateway.providers.map((config) => config.id));
  let number = gateway.providers.length + 1;
  while (taken.has(`provider-${number}`)) number += 1;
  const profile = providerProfiles.mistral;
  return {
    id: `provider-${number}`,
    name: `Provider ${number}`,
    provider: 'mistral',
    baseUrl: profile.baseUrl,
    models: { ...profile.defaults },
    auth: { type: 'api-key' },
  };
}

/**
 * The gateway without one provider; the default moves to the first one left.
 *
 * @param gateway - The gateway.
 * @param id - The provider to remove.
 * @returns The gateway, unchanged when it is the last provider.
 */
function withoutProvider(gateway: ModelGateway, id: string): ModelGateway {
  const providers = gateway.providers.filter((config) => config.id !== id);
  const first = providers[0];
  if (!first) return gateway;
  const defaultProviderId = gateway.defaultProviderId === id ? first.id : gateway.defaultProviderId;
  return { ...gateway, providers, defaultProviderId };
}

/**
 * The providers and their order, as the list shows them.
 *
 * @param gateway - The gateway.
 * @param selectedId - The provider being edited.
 * @param setGateway - Changes the gateway.
 * @param select - Selects a provider.
 * @returns Adding, removing, renaming and choosing the default.
 */
function providerActions(
  gateway: ModelGateway,
  selectedId: string,
  setGateway: (change: (current: ModelGateway) => ModelGateway) => void,
  select: (id: string) => void,
) {
  return {
    addProvider: () => {
      const config = newProvider(gateway);
      setGateway((current) => ({ ...current, providers: [...current.providers, config] }));
      select(config.id);
    },
    removeProvider: (id: string) => {
      const next = withoutProvider(gateway, id);
      setGateway(() => next);
      if (id === selectedId) select(next.defaultProviderId);
    },
    makeDefault: (id: string) => setGateway((current) => ({ ...current, defaultProviderId: id })),
  };
}

/**
 * The setters of the provider being edited: its fields, its name, its vendor and how it is
 * reached, and the shared limits and behaviour.
 *
 * @param id - The provider being edited.
 * @param saved - The saved gateway, to switch back to a saved vendor.
 * @param setGateway - Changes the gateway.
 * @returns The setters.
 */
function providerSetters(
  id: string,
  saved: ModelGateway,
  setGateway: (change: (current: ModelGateway) => ModelGateway) => void,
) {
  const setProvider = (change: (config: ProviderConfig) => ProviderConfig) =>
    setGateway((current) => ({
      ...current,
      providers: current.providers.map((config) => (config.id === id ? change(config) : config)),
    }));
  const savedConfig = saved.providers.find((config) => config.id === id);
  return {
    set: (path: string, value: unknown) =>
      /^(limits|behaviour)\./.test(path)
        ? setGateway((current) => setPath(current, path, value))
        : setProvider((config) => setPath(config, path, value)),
    rename: (name: string) => setProvider((config) => ({ ...config, name })),
    chooseProvider: (provider: ModelProvider) =>
      setProvider((config) => switchVendor(config, savedConfig, provider)),
    chooseConnection: (type: ProviderAuth['type']) =>
      setProvider((config) => switchConnection(config, savedConfig, type)),
  };
}

/**
 * The keys and client secrets typed but not saved yet, by provider.
 *
 * @param id - The provider being edited.
 * @returns Its typed secret, the setter, every typed secret, and a way to clear them all.
 */
function useTypedKeys(id: string) {
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const clearKeys = useCallback(() => setApiKeys({}), []);
  return {
    clearKeys,
    apiKey: apiKeys[id],
    setApiKey: (value: string | undefined) =>
      setApiKeys(({ [id]: _old, ...others }) => (value ? { ...others, [id]: value } : others)),
    apiKeys,
  };
}

/**
 * The form state of the model settings screen.
 *
 * @param stored - The saved gateway.
 * @returns The selected provider's settings, the setters, the providers' actions, the typed keys,
 *   and whether anything changed.
 */
export function useModelSettingsForm(stored: ModelGateway) {
  const saved = withProviderUrls(stored);
  const [gateway, setGateway] = useState(saved);
  const [selectedId, select] = useState(saved.defaultProviderId);
  const selected =
    gateway.providers.find((config) => config.id === selectedId) ?? gateway.providers[0];
  const id = selected?.id ?? '';
  const keys = useTypedKeys(id);
  const setters = providerSetters(id, saved, setGateway);
  return {
    gateway,
    selected,
    select,
    settings: settingsFor(gateway, id) as ModelSettings,
    ...setters,
    // A key typed for one way in is no secret for the other.
    chooseConnection: (type: ProviderAuth['type']) => {
      setters.chooseConnection(type);
      keys.setApiKey(undefined);
    },
    ...keys,
    ...providerActions(gateway, id, setGateway, select),
    dirty:
      Object.keys(keys.apiKeys).length > 0 || JSON.stringify(gateway) !== JSON.stringify(saved),
  };
}

/** The form state {@link useModelSettingsForm} returns. */
export type Form = ReturnType<typeof useModelSettingsForm>;

/** Props of the sections of the form. */
export interface SectionProps {
  /** The form state. */
  readonly form: Form;
  /** The server's issues by settings path. */
  readonly issues: Readonly<Record<string, string>>;
}
