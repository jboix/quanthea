/** Shows that a secret is stored without showing the secret. */

/** Shown for a stored secret value. */
const mask = '••••••••';

/**
 * Masks a secret value. Long values, such as API tokens, keep their last four characters so an
 * admin can tell which one is stored; short values, such as passwords, keep nothing.
 *
 * @param value - The secret value.
 * @returns The masked value.
 */
export function maskSecret(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length >= 16 ? `${mask}${text.slice(-4)}` : mask;
}
