/**
 * What `accounts` mode needs before it may start: keys kept out of the data directory, and the
 * address people reach querent at. A copy of the data directory must never carry a key. Keys not
 * given are generated outside it, so only a key file placed there on purpose is refused.
 */
import type { Config } from '../config/config.ts';
import type { KeyRing } from '../secrets/keys.ts';

/**
 * What is missing for `accounts` mode.
 *
 * @param config - The configuration.
 * @param keys - The keys read.
 * @returns One sentence per missing item; none when accounts can start.
 */
export function accountsProblems(config: Pick<Config, 'publicUrl'>, keys: KeyRing): string[] {
  return [
    keys.secretKeyInDataDir
      ? 'QUERENT_SECRET_KEY_FILE points into the data directory, and a copy of the data would carry it. Move the file out.'
      : undefined,
    config.publicUrl === undefined
      ? 'Set QUERENT_PUBLIC_URL to the address people reach querent at, such as https://querent.example.com.'
      : undefined,
  ].filter((problem) => problem !== undefined);
}
