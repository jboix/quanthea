/**
 * What changed between two alert specs, field by field, as the hand-edit card shows it and the
 * agent reads it: `condition.value: 0.03 → 0.02`.
 */
import type { SpecChange } from '../threads.ts';

/** The most changes one comparison lists. */
const maxChanges = 40;

/**
 * The leaves of a JSON value, by path. An array of plain values is one leaf.
 *
 * @param value - The value.
 * @param path - Its path so far.
 * @param leaves - Collects the leaves.
 * @returns The leaves.
 */
function leavesOf(value: unknown, path = '', leaves = new Map<string, string>()) {
  const entries = branchesOf(value);
  if (entries.length === 0) {
    if (value !== undefined) leaves.set(path, leafText(value));
    return leaves;
  }
  for (const [key, item] of entries) leavesOf(item, path ? `${path}.${key}` : key, leaves);
  return leaves;
}

/**
 * The entries of a plain object, which a comparison walks into.
 *
 * @param value - The value.
 * @returns Its entries; none for anything else, arrays included.
 */
function branchesOf(value: unknown): [string, unknown][] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
  return Object.entries(value);
}

/**
 * A leaf in words.
 *
 * @param value - The leaf.
 * @returns A string as it is, anything else as JSON.
 */
function leafText(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * The fields that differ between two specs.
 *
 * @param before - The earlier spec.
 * @param after - The later spec.
 * @returns Each changed field with its values before and after, at most forty.
 */
export function alertSpecChanges(before: unknown, after: unknown): SpecChange[] {
  const old = leavesOf(before);
  const next = leavesOf(after);
  const paths = [...new Set([...old.keys(), ...next.keys()])];
  return paths
    .filter((path) => old.get(path) !== next.get(path))
    .slice(0, maxChanges)
    .map((path) => {
      const was = old.get(path)?.slice(0, 2000);
      const now = next.get(path)?.slice(0, 2000);
      return {
        path,
        ...(was === undefined ? {} : { before: was }),
        ...(now === undefined ? {} : { after: now }),
      };
    });
}
