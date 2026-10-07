/**
 * Records the access of the answers stored before runs recorded it. Such an answer read data
 * through a tool call but holds no `data-sourceAccess` part, so no access change would count or
 * flag its thread. Each gets a record at the access its connectors have when the server starts,
 * the closest known to the access it read them at.
 */
import type { SourceAccess } from '@quanthea/shared';
import type { ThreadRepository } from '../db/thread-repository.ts';

/** The access a connector's results are read at now, by name; none for an unknown connector. */
export type AccessByName = (name: string) => SourceAccess | undefined;

/** The tool parts whose calls read a connector's data, named in their input's `connector`. */
const dataToolParts = new Set([
  'tool-describe',
  'tool-sample_values',
  'tool-test_query',
  'tool-edit_dashboard',
  'tool-edit_alert',
  'tool-replay_alert',
]);

/**
 * Adds every connector name a tool input holds, at any depth, under the key `connector`.
 *
 * @param value - The input, or a value inside it.
 * @param names - The names found so far.
 */
function collectConnectors(value: unknown, names: Set<string>): void {
  if (typeof value !== 'object' || value === null) return;
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'connector' && typeof entry === 'string') names.add(entry);
    else collectConnectors(entry, names);
  }
}

/**
 * The connectors an answer's data tool calls named.
 *
 * @param parts - The answer's parts.
 * @returns The connector names.
 */
function connectorsRead(parts: readonly unknown[]): Set<string> {
  const names = new Set<string>();
  for (const part of parts) {
    const { type, input } = (part ?? {}) as { type?: unknown; input?: unknown };
    if (typeof type === 'string' && dataToolParts.has(type)) collectConnectors(input, names);
  }
  return names;
}

/**
 * The access records an answer stored without them lacks, one per known connector it read.
 *
 * @param parts - The answer's parts.
 * @param accessOf - The access of a connector now, by name.
 * @returns The `data-sourceAccess` parts to add; none when it read no known connector.
 */
export function legacyAccessParts(parts: readonly unknown[], accessOf: AccessByName) {
  return [...connectorsRead(parts)].flatMap((name) => {
    const access = accessOf(name);
    return access ? [{ type: 'data-sourceAccess' as const, data: access }] : [];
  });
}

/**
 * Adds the access records the answers stored before runs recorded them lack. An answer already
 * recorded is left alone, so running it again changes nothing.
 *
 * @param repository - The threads' repository.
 * @param accessOf - The access of a connector now, by name.
 * @returns How many answers were amended.
 */
export function recordLegacyAccess(
  repository: Pick<ThreadRepository, 'unrecordedAnswers' | 'amendParts'>,
  accessOf: AccessByName,
): number {
  let amended = 0;
  for (const answer of repository.unrecordedAnswers()) {
    const records = legacyAccessParts(answer.parts, accessOf);
    if (records.length === 0) continue;
    repository.amendParts(answer.id, [...answer.parts, ...records]);
    amended += 1;
  }
  return amended;
}
