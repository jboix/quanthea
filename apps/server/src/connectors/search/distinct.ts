/**
 * How many distinct values the keyword fields of each index hold, estimated in one `_msearch`
 * when the schema is read. A field with eight values is a category to split by; one with two
 * million is an identifier to count or filter. The estimate reads at most 100,000 documents per
 * shard, so a large index costs no more than a small one.
 */
import type { SchemaEntity } from '../_shared/index.ts';
import type { SearchApi } from './api.ts';

/** The most keyword fields estimated per index. */
const maxFields = 50;

/** The documents each shard reads for the estimate. */
const documentsPerShard = 100_000;

/** The native types whose values are estimated. */
const keywordTypes = new Set(['keyword', 'constant_keyword', 'ip']);

/** One answer of the `_msearch`. */
interface Answer {
  /** The estimates, by the name the request gave each field. */
  readonly aggregations?: Readonly<Record<string, { readonly value?: number }>>;
}

/**
 * The keyword fields of an index worth estimating, at most {@link maxFields}.
 *
 * @param entity - The index or pattern.
 * @returns Their names.
 */
function keywordFields(entity: SchemaEntity): string[] {
  return entity.fields
    .filter((field) => keywordTypes.has(field.nativeType))
    .slice(0, maxFields)
    .map((field) => field.name);
}

/**
 * The two lines of one index in the `_msearch`: its header and a body of cardinality
 * aggregations, named `f0`, `f1` and so on after the fields' places.
 *
 * @param entity - The index or pattern.
 * @param fields - Its keyword fields.
 * @returns The lines.
 */
function linesOf(entity: SchemaEntity, fields: readonly string[]): string {
  const aggs = Object.fromEntries(
    fields.map((field, at) => [`f${at}`, { cardinality: { field, precision_threshold: 1000 } }]),
  );
  const header = { index: entity.name, ignore_unavailable: true };
  const body = { size: 0, track_total_hits: false, terminate_after: documentsPerShard, aggs };
  return `${JSON.stringify(header)}\n${JSON.stringify(body)}\n`;
}

/**
 * An index with the estimates of its answer on its fields.
 *
 * @param entity - The index or pattern.
 * @param fields - The fields estimated, in order.
 * @param answer - Its answer.
 * @returns The index, each estimated field with `distinctEstimate`.
 */
function withEstimates(
  entity: SchemaEntity,
  fields: readonly string[],
  answer: Answer | undefined,
): SchemaEntity {
  const estimates = new Map(
    fields.map((field, at) => [field, answer?.aggregations?.[`f${at}`]?.value]),
  );
  return {
    ...entity,
    fields: entity.fields.map((field) => {
      const estimate = estimates.get(field.name);
      return typeof estimate === 'number' ? { ...field, distinctEstimate: estimate } : field;
    }),
  };
}

/**
 * The indices with an estimate of distinct values on their keyword fields. A server that refuses
 * the request leaves the indices as they were: the estimate helps, and the schema stands without
 * it.
 *
 * @param api - The API.
 * @param entities - The indices and patterns.
 * @param signal - The caller's signal.
 * @returns The indices.
 */
export async function withDistinctEstimates(
  api: SearchApi,
  entities: readonly SchemaEntity[],
  signal: AbortSignal,
): Promise<SchemaEntity[]> {
  const asked = entities.map((entity) => ({ entity, fields: keywordFields(entity) }));
  const searched = asked.filter(({ fields }) => fields.length > 0);
  if (searched.length === 0) return [...entities];
  const lines = searched.map(({ entity, fields }) => linesOf(entity, fields)).join('');
  const answer = await api
    .request<{ responses?: Answer[] }>({ method: 'POST', path: '/_msearch', lines, signal })
    .catch(() => undefined);
  const answers = new Map(searched.map(({ entity }, at) => [entity, answer?.responses?.[at]]));
  return asked.map(({ entity, fields }) => withEstimates(entity, fields, answers.get(entity)));
}
