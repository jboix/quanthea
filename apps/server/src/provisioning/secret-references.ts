/**
 * Secrets in the configuration file: never written in clear, only as a reference to an environment
 * variable (`${NAME}`) or to a file (`file:/run/secrets/name`), such as a Docker or Kubernetes
 * secret. No message ever quotes a secret.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** A whole value that is one variable reference. */
const variableReference = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/;

/** A whole value that is a file reference. */
const fileReference = /^file:(.+)$/;

/**
 * Why a written secret is refused, without quoting it.
 *
 * @param written - The value as written.
 * @param where - Where it is set.
 * @returns The sentence.
 */
function clearSecretIssue(written: unknown, where: string): string {
  // Inside `{ }`, YAML reads an unquoted reference as a lone dollar sign.
  if (written === '$')
    return `${where}: put the variable reference in quotes, such as "\${VARIABLE}".`;
  return `${where} holds a secret in clear. Write \${VARIABLE} or file:/path instead.`;
}

/**
 * Reads a secret from its reference.
 *
 * @param written - The value as written in the file.
 * @param interpolated - The value once variables are replaced.
 * @param where - Where it is set, for messages.
 * @param issues - Collects what is wrong.
 * @returns The secret, or `undefined` when the reference is wrong.
 */
export function secretValue(
  written: unknown,
  interpolated: unknown,
  where: string,
  issues: string[],
): string | undefined {
  if (typeof written === 'string' && variableReference.test(written)) return String(interpolated);
  const path = typeof written === 'string' ? fileReference.exec(written)?.[1] : undefined;
  if (path === undefined) {
    issues.push(clearSecretIssue(written, where));
    return undefined;
  }
  try {
    return readFileSync(resolve(path.trim()), 'utf8').replace(/\r?\n$/, '');
  } catch {
    issues.push(`${where}: cannot read ${path.trim()}.`);
    return undefined;
  }
}

/**
 * Reads every secret of a mapping from its reference.
 *
 * @param written - The mapping as written in the file.
 * @param interpolated - The mapping once variables are replaced.
 * @param where - Where it is set, for messages.
 * @param issues - Collects what is wrong.
 * @returns The secrets by field.
 */
export function secretValues(
  written: unknown,
  interpolated: unknown,
  where: string,
  issues: string[],
): Record<string, string> {
  if (written === undefined) return {};
  if (written === null || typeof written !== 'object' || Array.isArray(written)) {
    issues.push(`${where} must be a mapping of secret fields.`);
    return {};
  }
  const values = interpolated as Record<string, unknown>;
  const secrets: Record<string, string> = {};
  for (const [field, value] of Object.entries(written)) {
    const secret = secretValue(value, values[field], `${where}.${field}`, issues);
    if (secret !== undefined) secrets[field] = secret;
  }
  return secrets;
}
