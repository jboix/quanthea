/**
 * Reads the shape of Elasticsearch and OpenSearch: the open indices from their mappings and
 * document counts, never their documents. Daily and rollover indices (`logs-2026.09.29`,
 * `logs-000042`) become one entity named by the pattern that queries them all (`logs-*`). Each
 * alias is an entity too, with the fields of the indices behind it, which it names.
 */
import type { SchemaEntity } from '../_shared/index.ts';
import type { SearchApi } from './api.ts';
import { fieldTypeOf, mappingDateFormats, mappingFields } from './columns.ts';
import { withDistinctEstimates } from './distinct.ts';

/** The mappings answer: each index and its mapping. */
type MappingsAnswer = Readonly<
  Record<string, { readonly mappings?: { readonly properties?: unknown } }>
>;

/** The aliases answer: each index, and the aliases that name it. */
export type AliasesAnswer = Readonly<
  Record<string, { readonly aliases?: Readonly<Record<string, { readonly filter?: unknown }>> }>
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
  /**
   * The format of each date field, by path: the one every index that has the field names, or
   * `null` when they differ or one of them names none.
   */
  readonly formats: Map<string, string | null>;
}

/**
 * A group with no index yet.
 *
 * @returns The group.
 */
function emptyGroup(): Group {
  return { indices: [], documents: 0, types: new Map(), formats: new Map() };
}

/**
 * Adds the date formats of one index to its group. A format stays only while every index that has
 * the field names the same one: a pattern over indices written differently has no one format.
 *
 * @param properties - The `properties` of the index's mapping.
 * @param formats - The group's formats, by path.
 */
function addDateFormats(properties: unknown, formats: Map<string, string | null>): void {
  const named = mappingDateFormats(properties);
  for (const [path, type] of mappingFields(properties)) {
    if (type !== 'date' && type !== 'date_nanos') continue;
    const format = named.get(path) ?? null;
    formats.set(path, formats.has(path) && formats.get(path) !== format ? null : format);
  }
}

/**
 * A field's type as the catalogue names it: a date with the format its mapping names, such as
 * `date (epoch_millis)`, so a reader knows how its values are written.
 *
 * @param type - The mapping type.
 * @param format - The one format its indices name, if they name one.
 * @returns The type name.
 */
function nativeTypeOf(type: string, format: string | null | undefined): string {
  return format === undefined || format === null ? type : `${type} (${format})`;
}

/**
 * Groups the open indices into entities.
 *
 * @param mappings - The mappings answer of every open index.
 * @param counts - The document counts.
 * @returns One entity per pattern or undated index.
 */
export function toEntities(
  mappings: MappingsAnswer,
  counts: readonly IndexRow[],
  aliases: AliasesAnswer = {},
): SchemaEntity[] {
  const documents = new Map(counts.map((row) => [row.index, Number(row['docs.count'] ?? 0)]));
  const groups = new Map<string, Group>();
  for (const index of Object.keys(mappings)) {
    const name = patternOf(index);
    const group: Group = groups.get(name) ?? emptyGroup();
    addIndex(group, index, mappings, documents);
    groups.set(name, group);
  }
  const indexEntities = [...groups].map(([name, group]) => toEntity(name, group));
  const aliasEntities = [...aliasMembers(aliases)].map(([name, alias]) => {
    const group = emptyGroup();
    for (const index of alias.indices) addIndex(group, index, mappings, documents);
    return aliasEntity(name, group, alias.filtered);
  });
  return [...indexEntities, ...aliasEntities]
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, maxEntities);
}

/**
 * Adds one open index to a group: its name, its documents, its fields and their date formats.
 *
 * @param group - The group.
 * @param index - The index.
 * @param mappings - The mappings answer.
 * @param documents - The document counts, by index.
 */
function addIndex(
  group: Group,
  index: string,
  mappings: MappingsAnswer,
  documents: ReadonlyMap<string, number>,
): void {
  const properties = mappings[index]?.mappings?.properties;
  if (properties === undefined && !(index in mappings)) return;
  group.indices.push(index);
  group.documents += documents.get(index) ?? 0;
  mappingFields(properties, group.types);
  addDateFormats(properties, group.formats);
}

/** An alias, as gathered from the indices it names. */
interface AliasMembers {
  /** The indices behind it. */
  readonly indices: string[];
  /** Whether it keeps only some of their documents. */
  filtered: boolean;
}

/**
 * The aliases, each with the indices behind it and whether it filters them. System aliases, which
 * start with a dot, are left out.
 *
 * @param answer - The aliases answer.
 * @returns The aliases, by name.
 */
function aliasMembers(answer: AliasesAnswer): Map<string, AliasMembers> {
  const aliases = new Map<string, AliasMembers>();
  for (const [index, entry] of Object.entries(answer)) {
    for (const [name, alias] of Object.entries(entry.aliases ?? {})) {
      if (name.startsWith('.')) continue;
      const members = aliases.get(name) ?? { indices: [], filtered: false };
      members.indices.push(index);
      members.filtered ||= alias.filter !== undefined;
      aliases.set(name, members);
    }
  }
  return aliases;
}

/**
 * The entity of an alias: the fields of the indices behind it, which it names, and their documents
 * unless it filters them, when how many it keeps is not known.
 *
 * @param name - The alias.
 * @param group - The open indices behind it.
 * @param filtered - Whether it keeps only some of their documents.
 * @returns The entity.
 */
function aliasEntity(name: string, group: Group, filtered: boolean): SchemaEntity {
  const sorted = [...group.indices].sort();
  const behind = sorted.length === 1 ? sorted[0] : `${sorted.length} indices`;
  const description = filtered
    ? `Alias of ${behind}, with a filter: it holds some of their documents.`
    : `Alias of ${behind}.`;
  const { rowEstimate, ...entity } = toEntity(name, group);
  const over = [...new Set([...sorted, ...sorted.map(patternOf)])];
  return {
    ...entity,
    description,
    ...(filtered || rowEstimate === undefined ? {} : { rowEstimate }),
    over,
  };
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
      nativeType: nativeTypeOf(type, group.formats.get(path)),
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
  const [mappings, counts, aliases] = await Promise.all([
    api.request<MappingsAnswer>({ path: '/_mapping', query: open, signal }),
    api.request<IndexRow[]>({
      path: '/_cat/indices',
      query: { ...open, format: 'json', h: 'index,docs.count' },
      signal,
    }),
    // Aliases add to the indices; credentials that may not list them still read the indices.
    api.request<AliasesAnswer>({ path: '/_alias', query: open, signal }).catch(() => ({})),
  ]);
  const entities = toEntities(mappings, counts, aliases);
  return { entities: await withDistinctEstimates(api, entities, signal) };
}
