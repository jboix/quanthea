/**
 * Reads the shape of a Valkey or Redis database without reading values beyond a few samples:
 * up to 2000 keys from `SCAN`, grouped into patterns by their last `:` segment
 * (`service:checkout-svc` and `service:cart-svc` become `service:*`), each with its type and the
 * fields its type has: a hash's field names, a sorted set's member and score, a stream's id, time
 * and fields.
 */
import type { SchemaEntity, SchemaField } from '../_shared/index.ts';
import type { ValkeySession } from './session.ts';

/** The most keys the catalog reads. */
const maxKeys = 2000;

/** How many keys of a pattern are opened to find its fields. */
const sampledKeys = 5;

/** Keys of one pattern and type. */
interface KeyGroup {
  /** The pattern, or the key when it is alone. */
  readonly pattern: string;
  /** The type. */
  readonly type: string;
  /** The keys. */
  readonly keys: string[];
}

/**
 * The pattern a key shares with its siblings.
 *
 * @param key - The key.
 * @returns Its last `:` segment as `*`, or the key without a `:`.
 */
export function patternOf(key: string): string {
  const colon = key.lastIndexOf(':');
  return colon === -1 ? key : `${key.slice(0, colon)}:*`;
}

/**
 * Reads the keys with `SCAN`, up to {@link maxKeys}.
 *
 * @param session - The session.
 * @param match - The pattern to match.
 * @param signal - The caller's signal.
 * @returns The keys.
 */
export async function scanKeys(
  session: ValkeySession,
  match: string,
  signal: AbortSignal,
): Promise<string[]> {
  const keys = new Set<string>();
  let cursor = '0';
  do {
    const [next, batch] = (await session.send(
      'SCAN',
      [cursor, 'MATCH', match, 'COUNT', '500'],
      signal,
    )) as [string, string[]];
    for (const key of batch) keys.add(key);
    cursor = String(next);
  } while (cursor !== '0' && keys.size < maxKeys);
  return [...keys].slice(0, maxKeys);
}

/**
 * Groups keys by pattern and type. A pattern with one key is named by the key.
 *
 * @param keys - The keys with their types.
 * @returns The groups, by name.
 */
export function groupKeys(keys: readonly (readonly [string, string])[]): KeyGroup[] {
  const groups = new Map<string, KeyGroup>();
  for (const [key, type] of keys) {
    const id = `${patternOf(key)} ${type}`;
    const group = groups.get(id) ?? { pattern: patternOf(key), type, keys: [] };
    group.keys.push(key);
    groups.set(id, group);
  }
  return [...groups.values()]
    .map((group) => ({ ...group, keys: [...group.keys].sort() }))
    .map((group) =>
      group.keys.length === 1 ? { ...group, pattern: group.keys[0] ?? group.pattern } : group,
    )
    .sort((a, b) => a.pattern.localeCompare(b.pattern));
}

/** A schema field, typed text unless said otherwise. */
const field = (
  name: string,
  nativeType: string,
  type: SchemaField['type'] = 'string',
): SchemaField => ({
  name,
  nativeType,
  type,
});

/**
 * The fields of a hash pattern: the field names of its first keys.
 *
 * @param session - The session.
 * @param keys - The keys.
 * @param signal - The caller's signal.
 * @returns The fields.
 */
async function hashFields(
  session: ValkeySession,
  keys: readonly string[],
  signal: AbortSignal,
): Promise<SchemaField[]> {
  const names = await Promise.all(
    keys
      .slice(0, sampledKeys)
      .map((key) => session.send('HKEYS', [key], signal) as Promise<string[]>),
  );
  return [...new Set(names.flat())].sort().map((name) => field(name, 'hash field'));
}

/**
 * The fields of a stream: its id, the time in the id, and the fields of its last entry.
 *
 * @param session - The session.
 * @param key - The stream.
 * @param signal - The caller's signal.
 * @returns The fields.
 */
async function streamFields(
  session: ValkeySession,
  key: string,
  signal: AbortSignal,
): Promise<SchemaField[]> {
  const [last] = (await session.send('XREVRANGE', [key, '+', '-', 'COUNT', '1'], signal)) as [
    string,
    string[],
  ][];
  const names = (last?.[1] ?? []).filter((_, index) => index % 2 === 0);
  return [
    field('id', 'stream id'),
    field('time', 'stream id time', 'time'),
    ...names.map((name) => field(name, 'stream field')),
  ];
}

/**
 * The fields of a group, by its type.
 *
 * @param session - The session.
 * @param group - The group.
 * @param signal - The caller's signal.
 * @returns The fields.
 */
async function fieldsOf(
  session: ValkeySession,
  group: KeyGroup,
  signal: AbortSignal,
): Promise<SchemaField[]> {
  if (group.type === 'zset')
    return [field('member', 'zset member'), field('score', 'zset score', 'number')];
  if (group.type === 'hash') return hashFields(session, group.keys, signal);
  if (group.type === 'stream') return streamFields(session, group.keys[0] ?? '', signal);
  return [field('value', group.type)];
}

/**
 * Describes a group.
 *
 * @param session - The session.
 * @param group - The group.
 * @param signal - The caller's signal.
 * @returns The entity.
 */
async function entityOf(
  session: ValkeySession,
  group: KeyGroup,
  signal: AbortSignal,
): Promise<SchemaEntity> {
  const description =
    group.keys.length > 1
      ? `${group.keys.length} ${group.type} keys, such as ${group.keys[0]}.`
      : `A ${group.type}.`;
  return {
    name: group.pattern,
    kind: 'table',
    description,
    fields: await fieldsOf(session, group, signal),
  };
}

/**
 * Reads the schema.
 *
 * @param session - The session.
 * @param signal - The caller's signal.
 * @returns One entity per pattern and type.
 */
export async function describeKeys(session: ValkeySession, signal: AbortSignal) {
  const keys = await scanKeys(session, '*', signal);
  const types = await Promise.all(keys.map((key) => session.send('TYPE', [key], signal)));
  const groups = groupKeys(keys.map((key, index) => [key, String(types[index])] as const));
  return { entities: await Promise.all(groups.map((group) => entityOf(session, group, signal))) };
}
