/**
 * What `accounts` mode needs before it may start: keys kept out of the data directory, and the
 * address people reach querent at. A copy of the data directory must never carry a key.
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
    keys.secretKeyOrigin === 'data-dir'
      ? 'Set QUERENT_SECRET_KEY, or QUERENT_SECRET_KEY_FILE outside the data directory: a key next to the database is copied with it. An existing data/secret.key can be moved there.'
      : undefined,
    keys.session === undefined
      ? 'Set QUERENT_SESSION_KEY (or QUERENT_SESSION_KEY_FILE).'
      : undefined,
    keys.pepper === undefined
      ? 'Set QUERENT_PASSWORD_PEPPER (or QUERENT_PASSWORD_PEPPER_FILE).'
      : undefined,
    config.publicUrl === undefined
      ? 'Set QUERENT_PUBLIC_URL to the address people reach querent at, such as https://querent.example.com.'
      : undefined,
  ].filter((problem) => problem !== undefined);
}
