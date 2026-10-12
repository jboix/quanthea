/**
 * The collections a MongoDB pipeline reads besides its own: `$lookup.from`, `$graphLookup.from`
 * and `$unionWith`, as a name or as `coll`. The binder checks their names and the scope check
 * what the connector shows of them, from this one list of stages.
 */

/** The stages that read another collection, with the key of their object that names it. */
const foreignKeys: ReadonlyMap<string, string> = new Map([
  ['$lookup', 'from'],
  ['$graphLookup', 'from'],
  ['$unionWith', 'coll'],
]);

/** One stage's reading of another collection. */
export interface ForeignRead {
  /** Whether the stage names a collection: a `$lookup` on `$documents` names none. */
  readonly named: boolean;
  /** What it names, a string when the stage is well formed. */
  readonly collection: unknown;
  /** Whether the stage names another database. */
  readonly otherDatabase: boolean;
}

/**
 * What a key of a pipeline reads besides the pipeline's own collection.
 *
 * @param key - A key, such as `$lookup`.
 * @param value - Its value.
 * @returns The reading, or `undefined` for a key that reads no other collection.
 */
function foreignRead(key: string, value: unknown): ForeignRead | undefined {
  if (key === '$unionWith' && typeof value === 'string') {
    return { named: true, collection: value, otherDatabase: false };
  }
  const field = foreignKeys.get(key);
  if (field === undefined || value === null || typeof value !== 'object') return undefined;
  const stage = value as Readonly<Record<string, unknown>>;
  return { named: field in stage, collection: stage[field], otherDatabase: 'db' in stage };
}

/**
 * Every reading of another collection in a pipeline or a part of it, in nested pipelines too.
 *
 * @param node - The pipeline or a part of it.
 * @returns The readings, in the order the pipeline writes them.
 */
export function foreignReads(node: unknown): ForeignRead[] {
  if (node === null || typeof node !== 'object') return [];
  return Object.entries(node).flatMap(([key, value]) => {
    const read = foreignRead(key, value);
    return [...(read === undefined ? [] : [read]), ...foreignReads(value)];
  });
}
