/**
 * Reads the shape of a MongoDB database: its collections and views, each with the fields of a few
 * sampled documents and their types, nested ones as dotted names, and the collection's estimated
 * document count. Distinct values of a field come from a `$group` on it.
 */
import type { Db, Document } from 'mongodb';
import {
  ConnectorError,
  type FieldReference,
  type SampleResult,
  type SchemaEntity,
  type SchemaField,
  type SchemaSnapshot,
} from '../_shared/index.ts';
import { columnType, flatten, type Leaf, leafOf } from './frames.ts';

/** The most collections the catalog lists. */
const maxCollections = 200;

/** How many documents of a collection are sampled for its fields. */
const sampledDocuments = 20;

/** The most fields an entity lists. */
const maxFields = 100;

/** How many collections are read at once. */
const parallelReads = 8;

/** How long one command of the catalog may run on the server, in milliseconds. */
const commandTimeoutMs = 10_000;

/** A field path: names of letters, digits, `_` and `-`, joined by dots. */
const fieldPath = /^[A-Za-z_][A-Za-z0-9_-]*(\.[A-Za-z_][A-Za-z0-9_-]*)*$/;

/** A collection as `listCollections` gives it. */
interface CollectionInfo {
  /** Its name. */
  readonly name: string;
  /** `collection`, `view` or `timeseries`. */
  readonly type?: string;
}

/**
 * The fields of sampled documents: each name in first-seen order, with its BSON and frame types.
 *
 * @param documents - The documents.
 * @returns The fields.
 */
export function fieldsOf(documents: readonly Document[]): SchemaField[] {
  const leaves = new Map<string, Leaf[]>();
  for (const document of documents)
    for (const [name, value] of flatten(document)) {
      const list = leaves.get(name) ?? [];
      list.push(leafOf(value));
      leaves.set(name, list);
    }
  return [...leaves].slice(0, maxFields).map(([name, values]) => {
    const natives = [...new Set(values.map((leaf) => leaf.nativeType))].filter((t) => t !== 'null');
    return { name, nativeType: natives.join('|') || 'null', type: columnType(values) };
  });
}

/**
 * One collection as an entity.
 *
 * @param database - The database.
 * @param info - The collection.
 * @param signal - The caller's signal.
 * @returns The entity.
 */
async function entityOf(
  database: Db,
  info: CollectionInfo,
  signal: AbortSignal,
): Promise<SchemaEntity> {
  const collection = database.collection(info.name);
  const options = { maxTimeMS: commandTimeoutMs, signal };
  const documents = await collection
    .aggregate([{ $sample: { size: sampledDocuments } }], options)
    .toArray();
  const view = info.type === 'view';
  const rowEstimate = view ? undefined : await collection.estimatedDocumentCount(options);
  return {
    name: info.name,
    kind: view ? 'view' : 'collection',
    ...(rowEstimate === undefined ? {} : { rowEstimate }),
    fields: fieldsOf(documents),
  };
}

/**
 * Reads the collections and views of the database.
 *
 * @param database - The database.
 * @param signal - The caller's signal.
 * @returns The snapshot, collections by name.
 */
export async function describeDatabase(database: Db, signal: AbortSignal): Promise<SchemaSnapshot> {
  const infos = (await database
    .listCollections({}, { nameOnly: true, authorizedCollections: true, signal })
    .toArray()) as CollectionInfo[];
  const readable = infos
    .filter((info) => !info.name.startsWith('system.'))
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, maxCollections);
  const entities: SchemaEntity[] = [];
  for (let start = 0; start < readable.length; start += parallelReads) {
    const batch = readable.slice(start, start + parallelReads);
    entities.push(...(await Promise.all(batch.map((info) => entityOf(database, info, signal)))));
  }
  return { entities };
}

/**
 * A value as text: a time as ISO 8601.
 *
 * @param leaf - The value.
 * @returns The text.
 */
function textOf(leaf: Leaf): string {
  if (leaf.type === 'time') return new Date(leaf.value as number).toISOString();
  return String(leaf.value);
}

/**
 * Reads distinct values of a field, by grouping on it.
 *
 * @param database - The database.
 * @param field - The collection and the field path.
 * @param limit - How many values at most.
 * @param signal - The caller's signal.
 * @returns The values as text and whether there are more.
 * @throws {ConnectorError} `not_found` for a field path the catalog would not list.
 */
export async function sampleField(
  database: Db,
  field: FieldReference,
  limit: number,
  signal: AbortSignal,
): Promise<SampleResult> {
  if (!fieldPath.test(field.field) || field.entity.startsWith('system.'))
    throw new ConnectorError('not_found', `"${field.entity}" has no field "${field.field}".`);
  const groups = await database
    .collection(field.entity)
    .aggregate(
      [
        { $match: { [field.field]: { $exists: true, $ne: null } } },
        { $group: { _id: `$${field.field}` } },
        { $limit: limit + 1 },
      ],
      { maxTimeMS: commandTimeoutMs, signal },
    )
    .toArray();
  const values = groups.map((group) => textOf(leafOf(group._id)));
  return { values: values.slice(0, limit), complete: values.length <= limit };
}
