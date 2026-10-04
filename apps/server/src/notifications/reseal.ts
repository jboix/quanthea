/** Seals every channel's target again with the current key, after a key rotation. */
import type { ChannelRepository } from '../db/channel-repository.ts';
import type { SecretBox } from '../secrets/secret-box.ts';
import { openTarget, sealTarget } from './channel-store.ts';

/**
 * Seals again the channel targets not sealed with the current key.
 *
 * @param repository - The channels.
 * @param secretBox - The secret box, which opens values the previous key sealed.
 * @returns How many were sealed again.
 */
export async function resealChannels(
  repository: ChannelRepository,
  secretBox: SecretBox,
): Promise<number> {
  let count = 0;
  for (const row of repository.list()) {
    if (secretBox.isCurrent(row.secret)) continue;
    const sealed = await openTarget(secretBox, row);
    repository.save({ ...row, secret: await sealTarget(secretBox, row.id, sealed) });
    count += 1;
  }
  return count;
}
