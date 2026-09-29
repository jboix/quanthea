/**
 * Seals every connector's credentials again with the current key: after a key rotation, and for
 * values sealed before sealed values carried a key id.
 */
import type { ConnectorRepository } from '../db/connector-repository.ts';
import type { SecretBox } from '../secrets/secret-box.ts';

/**
 * Seals again the connector credentials not sealed with the current key.
 *
 * @param repository - The connectors.
 * @param secretBox - The secret box, which opens values the previous key sealed.
 * @returns How many were sealed again.
 */
export async function resealConnectors(
  repository: ConnectorRepository,
  secretBox: SecretBox,
): Promise<number> {
  let count = 0;
  for (const row of repository.list()) {
    if (secretBox.isCurrent(row.secret)) continue;
    const plaintext = await secretBox.open(row.secret, row.id);
    repository.save({ ...row, secret: await secretBox.seal(plaintext, row.id) });
    count += 1;
  }
  return count;
}
