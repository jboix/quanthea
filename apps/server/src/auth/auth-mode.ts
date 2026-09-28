/** Decides which authentication mode the server starts in. */
import type { AuthMode } from '@querent/shared';
import type { Logger } from '../lib/logger.ts';
import type { SettingsStore } from '../settings/settings-store.ts';

/**
 * Picks the authentication mode: the environment override when set, else the stored setting.
 * An override is logged as a warning because it bypasses what an admin saved.
 *
 * @param override - The value of `QUERENT_AUTH_MODE`, when set.
 * @param settings - The settings store holding the saved mode.
 * @param logger - Receives the override warning.
 * @returns The mode to start in.
 */
export function resolveAuthMode(
  override: AuthMode | undefined,
  settings: SettingsStore,
  logger: Logger,
): AuthMode {
  const stored = settings.read('auth').mode;
  if (override === undefined) return stored;
  if (override !== stored) {
    logger.warn('QUERENT_AUTH_MODE overrides the stored authentication mode.', {
      stored,
      override,
    });
  }
  return override;
}
