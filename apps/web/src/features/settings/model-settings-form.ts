/** The model settings form state: the settings as edited, and the new key if one is typed. */
import { type ModelProvider, type ModelSettings, providerProfiles } from '@querent/shared';
import { useState } from 'react';

/**
 * Sets a value at a dotted path of the settings, returning new settings.
 *
 * @param settings - The settings.
 * @param path - Such as `limits.toolCallsPerTurn`.
 * @param value - The new value.
 * @returns The changed settings.
 */
function setPath(settings: ModelSettings, path: string, value: unknown): ModelSettings {
  const [head, ...rest] = path.split('.');
  const key = head ?? '';
  const current = (settings as unknown as Record<string, unknown>)[key];
  const next = rest.length === 0 ? value : setPath(current as ModelSettings, rest.join('.'), value);
  return { ...settings, [key]: next } as ModelSettings;
}

/**
 * The settings with the provider's own API written out, so the form shows where requests go.
 *
 * @param settings - The settings.
 * @returns The settings, with the provider's base URL when none is set.
 */
function withProviderUrl(settings: ModelSettings): ModelSettings {
  if (settings.baseUrl !== null) return settings;
  return { ...settings, baseUrl: providerProfiles[settings.provider].baseUrl };
}

/**
 * Switches provider: back to the saved settings for the saved provider, or to the new provider's
 * API and starting models.
 *
 * @param current - The settings as edited.
 * @param saved - The saved settings, with the provider's URL written out.
 * @param provider - The provider chosen.
 * @returns The settings for that provider.
 */
function switchProvider(
  current: ModelSettings,
  saved: ModelSettings,
  provider: ModelProvider,
): ModelSettings {
  if (provider === saved.provider) {
    return { ...current, provider, baseUrl: saved.baseUrl, models: saved.models };
  }
  const profile = providerProfiles[provider];
  return { ...current, provider, baseUrl: profile.baseUrl, models: { ...profile.defaults } };
}

/**
 * The form state of the model settings screen.
 *
 * @param stored - The saved settings.
 * @returns The edited settings, the typed key, setters, and whether anything changed.
 */
export function useModelSettingsForm(stored: ModelSettings) {
  const saved = withProviderUrl(stored);
  const [settings, setSettings] = useState(saved);
  const [apiKey, setApiKey] = useState<string | undefined>(undefined);
  const set = (path: string, value: unknown) =>
    setSettings((current) => setPath(current, path, value));
  const chooseProvider = (provider: ModelProvider) =>
    setSettings((current) => switchProvider(current, saved, provider));
  const dirty = apiKey !== undefined || JSON.stringify(settings) !== JSON.stringify(saved);
  return { settings, set, chooseProvider, apiKey, setApiKey, dirty };
}
