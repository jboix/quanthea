/**
 * The system settings as Settings → Server shows them: each value with where it comes from, and
 * each key with where it comes from, never its value.
 */
import type { ServerSettingsView, SettingSource } from '@querent/shared';
import type { KeyInputs, KeyOrigin } from '../secrets/keys.ts';
import { type Config, type SettingKey, settingSpecs } from './config.ts';

/** What each key is for, in the order the page lists them. */
const keyLabels: Readonly<Record<keyof KeyInputs, string>> = {
  secret: 'Secret key',
  secretPrevious: 'Previous secret key, rotating out',
  session: 'Session key',
  pepper: 'Password pepper',
  pepperPrevious: 'Previous password pepper, rotating out',
};

/**
 * A setting's value as text.
 *
 * @param config - The configuration.
 * @param key - The setting.
 * @returns The value, or `null` when it is not set.
 */
function settingValue(config: Config, key: SettingKey): string | null {
  const value = (config as unknown as Record<SettingKey, unknown>)[key];
  return value === undefined ? null : String(value);
}

/**
 * A key's origin as a setting source, and the file a variable names.
 *
 * @param origin - Where the key comes from.
 * @returns The source and the file.
 */
function keySource(origin: KeyOrigin): { source: SettingSource; file: string | null } {
  if (origin.kind === 'generated')
    return { source: { kind: 'generated', path: origin.path }, file: null };
  const source: SettingSource = { kind: 'environment', variable: origin.variable };
  return { source, file: origin.kind === 'file' ? origin.path : null };
}

/**
 * The system settings view.
 *
 * @param config - The configuration.
 * @param origins - Where each key in use comes from.
 * @returns The view.
 */
export function serverSettingsView(
  config: Config,
  origins: Readonly<Partial<Record<keyof KeyInputs, KeyOrigin>>>,
): ServerSettingsView {
  const settings = (Object.keys(settingSpecs) as SettingKey[]).map((key) => ({
    key,
    label: settingSpecs[key].label,
    value: settingValue(config, key),
    source: config.sources[key],
    variable: settingSpecs[key].variable,
  }));
  const keys = (Object.keys(keyLabels) as (keyof KeyInputs)[]).flatMap((field) => {
    const origin = origins[field];
    return origin ? [{ label: keyLabels[field], ...keySource(origin) }] : [];
  });
  return { configFiles: [...config.configFiles], settings, keys };
}
