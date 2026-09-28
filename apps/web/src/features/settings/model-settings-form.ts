/** The model settings form state: the settings as edited, and the new key if one is typed. */
import type { ModelSettings } from '@querent/shared';
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
 * The form state of the model settings screen.
 *
 * @param saved - The saved settings.
 * @returns The edited settings, the typed key, setters, and whether anything changed.
 */
export function useModelSettingsForm(saved: ModelSettings) {
  const [settings, setSettings] = useState(saved);
  const [apiKey, setApiKey] = useState<string | undefined>(undefined);
  const set = (path: string, value: unknown) =>
    setSettings((current) => setPath(current, path, value));
  const dirty = apiKey !== undefined || JSON.stringify(settings) !== JSON.stringify(saved);
  const reset = (next: ModelSettings) => {
    setSettings(next);
    setApiKey(undefined);
  };
  return { settings, set, apiKey, setApiKey, dirty, reset };
}
