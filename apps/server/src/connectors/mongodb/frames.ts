/**
 * Turns MongoDB documents into a table: a column per value the first documents hold, nested
 * objects as dotted names (`customer.country`), arrays and other values as Extended JSON text. A
 * date is a time, the numeric BSON types are numbers, an ObjectId is its hex text.
 */
import type { Field, FieldType, Frame } from '@querent/shared';
import { BSON, type Document } from 'mongodb';
import { createFrameBuilder, type ExecutionContext } from '../_shared/index.ts';

/** How many documents the columns are read from. */
const sampledDocuments = 100;

/** The most columns a table gets. */
const maxColumns = 50;

/** How deep nested objects become dotted names. */
const maxDepth = 4;

/** A value as a frame holds it, with its frame type and its BSON type name. */
export interface Leaf {
  /** The frame type, or `null` for a missing value. */
  readonly type: FieldType | null;
  /** The BSON type name, such as `date`, `decimal` or `objectId`. */
  readonly nativeType: string;
  /** Epoch milliseconds, a number, a boolean, text, or `null`. */
  readonly value: number | string | boolean | null;
}

/** BSON number types, as the driver gives them when it does not make them JS numbers. */
const numberTypes: ReadonlyMap<string, string> = new Map([
  ['Decimal128', 'decimal'],
  ['Long', 'long'],
  ['Int32', 'int'],
  ['Double', 'double'],
]);

/**
 * A value as a frame holds it.
 *
 * @param value - The value from a document.
 * @returns The value, its frame type and its BSON type name.
 */
export function leafOf(value: unknown): Leaf {
  if (value === null || value === undefined) return { type: null, nativeType: 'null', value: null };
  if (value instanceof Date) return { type: 'time', nativeType: 'date', value: value.getTime() };
  if (typeof value === 'number') return numberLeaf('double', value);
  if (typeof value === 'boolean') return { type: 'boolean', nativeType: 'bool', value };
  if (typeof value === 'string') return { type: 'string', nativeType: 'string', value };
  return bsonLeaf(value);
}

/**
 * A number as a frame holds it: NaN and the infinities are missing values.
 *
 * @param nativeType - The BSON type name.
 * @param value - The number.
 * @returns The value.
 */
function numberLeaf(nativeType: string, value: number): Leaf {
  return { type: 'number', nativeType, value: Number.isFinite(value) ? value : null };
}

/**
 * A BSON object, an array or a document as a frame holds it.
 *
 * @param value - The value.
 * @returns The value, its frame type and its BSON type name.
 */
function bsonLeaf(value: unknown): Leaf {
  const bsonType = (value as { _bsontype?: string })._bsontype ?? '';
  const numberType = numberTypes.get(bsonType);
  if (numberType) return numberLeaf(numberType, Number(String(value)));
  if (bsonType === 'ObjectId')
    return {
      type: 'string',
      nativeType: 'objectId',
      value: (value as BSON.ObjectId).toHexString(),
    };
  const nativeType = Array.isArray(value) ? 'array' : bsonType || 'object';
  return { type: 'string', nativeType, value: BSON.EJSON.stringify(value, { relaxed: true }) };
}

/**
 * Whether a value is a document to walk into, not a BSON value or an array.
 *
 * @param value - The value.
 * @returns `true` for a plain object.
 */
function isDocument(value: unknown): value is Document {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    !('_bsontype' in value)
  );
}

/**
 * The values of a document by dotted name, nested documents walked.
 *
 * @param document - The document.
 * @param prefix - The name of the enclosing document.
 * @param into - Where the values go.
 * @param depth - How deep the document is.
 * @returns `into`.
 */
export function flatten(
  document: Document,
  prefix = '',
  into: Map<string, unknown> = new Map(),
  depth = 0,
): Map<string, unknown> {
  for (const [key, value] of Object.entries(document)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (isDocument(value) && depth < maxDepth && Object.keys(value).length > 0)
      flatten(value, name, into, depth + 1);
    else into.set(name, value);
  }
  return into;
}

/**
 * The type of a column: the type every present value has, else text.
 *
 * @param leaves - The column's values.
 * @returns The type.
 */
export function columnType(leaves: readonly Leaf[]): FieldType {
  const types = new Set(leaves.map((leaf) => leaf.type).filter((type) => type !== null));
  const [only] = types;
  return types.size === 1 && only !== undefined ? only : 'string';
}

/**
 * A value as its column holds it: as it is when the types agree, else as text.
 *
 * @param type - The column type.
 * @param leaf - The value.
 * @returns The cell.
 */
function cellOf(type: FieldType, leaf: Leaf): unknown {
  if (leaf.value === null || leaf.type === type) return leaf.value;
  if (leaf.type === 'time') return new Date(leaf.value as number).toISOString();
  return String(leaf.value);
}

/**
 * The frame of the documents an aggregation returned.
 *
 * @param documents - The documents, one more than the row limit when there were more.
 * @param context - The execution context.
 * @param durationMs - How long the query took.
 * @returns The frame.
 */
export function frameOf(
  documents: readonly Document[],
  context: ExecutionContext,
  durationMs: number,
): Frame {
  const rows = documents.map((document) => flatten(document));
  const names = [...new Set(rows.slice(0, sampledDocuments).flatMap((row) => [...row.keys()]))];
  const columns = names.slice(0, maxColumns);
  const leaves = rows.map((row) => columns.map((name) => leafOf(row.get(name))));
  const fields: Field[] = columns.map((name, index) => ({
    name,
    type: columnType(leaves.slice(0, sampledDocuments).map((row) => row[index] ?? leafOf(null))),
  }));
  const builder = createFrameBuilder({ refId: context.refId, fields, maxRows: context.maxRows });
  for (const row of leaves) {
    const values = fields.map((field, index) => cellOf(field.type, row[index] ?? leafOf(null)));
    if (!builder.add(values)) break;
  }
  return builder.build(durationMs);
}
