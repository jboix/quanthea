/**
 * The scenario's finished steps, kept in `.state/steps.json`: a run that fails, such as on a spent
 * quota, starts again where it stopped instead of from the beginning.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { progress } from './client.ts';

/** Where the finished steps and their results go. */
const stepsFile = join(import.meta.dir, '.state', 'steps.json');

/**
 * The steps finished so far, by name.
 *
 * @returns Each finished step's result.
 */
function finished(): Record<string, unknown> {
  if (!existsSync(stepsFile)) return {};
  return JSON.parse(readFileSync(stepsFile, 'utf8')) as Record<string, unknown>;
}

/**
 * Runs a step once: a step a run before finished gives back the result it saved.
 *
 * @param name - The step's name, such as `shop`.
 * @param run - Does the step; its result must be JSON.
 * @returns The step's result.
 */
export async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  const before = finished();
  if (name in before) {
    progress(`Done before: ${name}`);
    return before[name] as T;
  }
  const result = await run();
  const after = { ...finished(), [name]: result ?? null };
  writeFileSync(stepsFile, `${JSON.stringify(after, null, 2)}\n`);
  return result;
}
