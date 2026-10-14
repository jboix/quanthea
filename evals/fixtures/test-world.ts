/** Worlds for the fixtures' tests, each in a folder of its own, closed after each test. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type EvalWorld, openWorld } from '../world/setup.ts';

/** The worlds opened since the last close, with their folders. */
const opened: { world: EvalWorld; dir: string }[] = [];

/**
 * A world of its own, with no key: nothing in these tests calls a model.
 *
 * @returns The world.
 */
export async function world(): Promise<EvalWorld> {
  const dir = mkdtempSync(join(tmpdir(), 'quanthea-fixtures-test-'));
  const cache = { dir, read: true, minIntervalMs: 0 };
  const made = await openWorld({ provider: 'anthropic', model: 'a-model' }, undefined, cache);
  opened.push({ world: made, dir });
  return made;
}

/**
 * Closes every world opened since the last call, and removes its folder.
 *
 * @returns Once all are closed.
 */
export async function closeWorlds(): Promise<void> {
  for (const { world: made, dir } of opened.splice(0)) {
    await made.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
