/**
 * Reads the shape of Elasticsearch and OpenSearch: the open indices from their mappings and
 * document counts, never their documents. Daily and rollover indices (`logs-2026.09.29`,
 * `logs-000042`) become one entity named by the pattern that queries them all (`logs-*`).
 */
import type { SchemaEntity } from '../_shared/index.ts';
import type { SearchApi } from './api.ts';
import { fieldTypeOf, mappingFields } from './columns.ts';

/** The mappings answer: each index and its mapping. */
type MappingsAnswer = Readonly<
  Record<string, { readonly mappings?: { readonly properties?: unknown } }>
>;

/** One row of `_cat/indices`. */
interface IndexRow {
  /** The index name. */
  readonly index: string;
  /** Its document count, as text. */
  readonly 'docs.count'?: string | null;
}

/** An index name that ends with a date or a rollover number. */
const dated = /^(.*?[-_.])(?:\d{4}[-_.]\d{2}[-_.]\d{2}|\d{4}[-_.]\d{2}|\d{6})$/;

/** The most entities a snapshot lists. */
const maxEntities = 500;

/**
 * The pattern that queries an index with its siblings.
 *
 * @param index - The index name.
 * @returns Such as `logs-*` for `logs-2026.09.29`, or the name itself.
 */
export function patternOf(index: string): string {
  const match = dated.exec(index);
  return match ? `${match[1]}*` : index;
}

/**
 * The field types of every index a name or pattern covers, merged.
 *
 * @param answer - The mappings answer.
 * @returns The types, by dotted path.
 */
export function mergedTypes(answer: MappingsAnswer): Map<string, string> {
  const types = new Map<string, string>();
  for (const index of Object.values(answer)) mappingFields(index.mappings?.properties, types);
  return types;
}

/** An entity being gathered from its indices. */
interface Group {
  /** The indices, by name. */
  readonly indices: string[];
  /** The documents in them. */
  documents: number;
  /** The field types, by path. */
  readonly types: Map<string, string>;
}

/**
 * Groups the open indices into entities.
 *
 * @param mappings - The mappings answer of every open index.
 * @param counts - The document counts.
 * @returns One entity per pattern or undated index.
 */
export function toEntities(mappings: MappingsAnswer, counts: readonly IndexRow[]): SchemaEntity[] {
  const documents = new Map(counts.map((row) => [row.index, Number(row['docs.count'] ?? 0)]));
  const groups = new Map<string, Group>();
  for (const [index, mapping] of Object.entries(mappings)) {
    const name = patternOf(index);
    const group: Group = groups.get(name) ?? { indices: [], documents: 0, types: new Map() };
    group.indices.push(index);
    group.documents += documents.get(index) ?? 0;
    mappingFields(mapping.mappings?.properties, group.types);
    groups.set(name, group);
  }
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, maxEntities)
    .map(([name, group]) => toEntity(name, group));
}

/**
 * The entity of a group of indices.
 *
 * @param name - The pattern or index name.
 * @param group - The indices, documents and fields.
 * @returns The entity.
 */
function toEntity(name: string, group: Group): SchemaEntity {
  const sorted = [...group.indices].sort();
  const description =
    sorted.length > 1 ? `${sorted.length} indices, ${sorted[0]} to ${sorted.at(-1)}.` : undefined;
  return {
    name,
    kind: 'index',
    ...(description ? { description } : {}),
    rowEstimate: group.documents,
    fields: [...group.types].map(([path, type]) => ({
      name: path,
      nativeType: type,
      type: fieldTypeOf(type),
    })),
  };
}

/**
 * Reads the schema.
 *
 * @param api - The API.
 * @param signal - The caller's signal.
 * @returns The schema snapshot.
 */
export async function describeIndices(api: SearchApi, signal: AbortSignal) {
  const open = { expand_wildcards: 'open' };
  const [mappings, counts] = await Promise.all([
    api.request<MappingsAnswer>({ path: '/_mapping', query: open, signal }),
    api.request<IndexRow[]>({
      path: '/_cat/indices',
      query: { ...open, format: 'json', h: 'index,docs.count' },
      signal,
    }),
  ]);
  return { entities: toEntities(mappings, counts) };
}
