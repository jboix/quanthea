/**
 * The documents a search returns, as one table: a column per field of `_source`, nested objects
 * flattened to dotted paths, typed from the index mapping.
 */
import type { Field, Frame } from '@quanthea/shared';
import { createFrameBuilder, type ExecutionContext } from '../_shared/index.ts';
import { fieldTypeOf, frameValue } from './columns.ts';

/** One hit. */
interface Hit {
  /** The document. */
  readonly _source?: Readonly<Record<string, unknown>>;
}

/** The most columns a table of documents gets. */
const maxColumns = 100;

/**
 * Flattens a document to dotted paths. Arrays stay values.
 *
 * @param document - The document.
 * @param into - Where to put the values, by path.
 * @param prefix - The path of the enclosing object.
 * @returns `into`.
 */
export function flatten(
  document: Readonly<Record<string, unknown>>,
  into: Map<string, unknown> = new Map(),
  prefix = '',
): Map<string, unknown> {
  for (const [name, value] of Object.entries(document)) {
    const path = `${prefix}${name}`;
    const isObject = typeof value === 'object' && value !== null && !Array.isArray(value);
    if (isObject) flatten(value as Record<string, unknown>, into, `${path}.`);
    else into.set(path, value);
  }
  return into;
}

/**
 * The columns of a set of documents: every path, in the order they first appear.
 *
 * @param documents - The flattened documents.
 * @param types - The mapping types, by path.
 * @returns The fields.
 */
function columnsOf(
  documents: readonly Map<string, unknown>[],
  types: ReadonlyMap<string, string>,
): Field[] {
  const paths = new Set<string>();
  for (const document of documents) for (const path of document.keys()) paths.add(path);
  return [...paths]
    .slice(0, maxColumns)
    .map((path) => ({ name: path, type: fieldTypeOf(types.get(path)) }));
}

/**
 * The table of the documents a search returned.
 *
 * @param hits - The hits, `hits.hits` of the answer.
 * @param types - The mapping types, by path.
 * @param context - The execution context.
 * @param durationMs - How long the search took.
 * @returns The frame.
 */
export function hitsFrame(
  hits: readonly Hit[],
  types: ReadonlyMap<string, string>,
  context: ExecutionContext,
  durationMs: number,
): Frame {
  const documents = hits.map((hit) => flatten(hit._source ?? {}));
  const fields = columnsOf(documents, types);
  const builder = createFrameBuilder({ refId: context.refId, fields, maxRows: context.maxRows });
  for (const document of documents) {
    const row = fields.map((field) => frameValue(field.type, document.get(field.name)));
    if (!builder.add(row)) break;
  }
  return builder.build(durationMs);
}
