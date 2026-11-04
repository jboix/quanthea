/**
 * Notes on the raw searches an edit sends that a search builder writes: plain filters, a sort and
 * one aggregation of a kind a builder makes. The panel is saved as it is; the note names the
 * builder, which checks the fields and the buckets that a raw search leaves to the model.
 */
import type { EditRequest } from '../dashboards/panels/index.ts';

/** A JSON object, as a search body holds them. */
type JsonObject = Readonly<Record<string, unknown>>;

/** The keys of a body a builder writes. */
const bodyKeys: ReadonlySet<string> = new Set([
  'query',
  'size',
  'sort',
  'aggs',
  'aggregations',
  'track_total_hits',
  '_source',
]);

/** The query clauses a builder's filters write. */
const filterClauses: ReadonlySet<string> = new Set([
  'term',
  'terms',
  'range',
  'exists',
  'wildcard',
  'prefix',
  'match',
  'match_phrase',
]);

/** The aggregations a builder computes for one number. */
const metricKinds: ReadonlySet<string> = new Set([
  'avg',
  'sum',
  'min',
  'max',
  'cardinality',
  'value_count',
  'percentiles',
]);

/**
 * Whether a value is a JSON object.
 *
 * @param value - The value.
 * @returns Whether it is an object and not a list.
 */
function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Whether a query clause is a filter a builder writes, alone or inside a `bool`.
 *
 * @param clause - The clause.
 * @returns Whether a builder writes it.
 */
function isPlainClause(clause: unknown): boolean {
  if (!isObject(clause)) return false;
  const [kind, ...more] = Object.keys(clause);
  if (kind === undefined || more.length > 0) return false;
  if (kind === 'match_all') return true;
  if (kind !== 'bool') return filterClauses.has(kind);
  const parts = Object.values(clause.bool as JsonObject);
  return parts.flat().every(isPlainClause);
}

/**
 * The kind of an aggregation and its own sub-aggregations.
 *
 * @param aggregation - The aggregation.
 * @returns Its kind, and its sub-aggregations by name; no kind when it has several.
 */
function kindOf(aggregation: unknown): { kind: string | undefined; subs: unknown[] } {
  if (!isObject(aggregation)) return { kind: undefined, subs: [] };
  const { aggs, aggregations, meta: _, ...rest } = aggregation;
  const kinds = Object.keys(rest);
  const nested = aggs ?? aggregations;
  const subs = isObject(nested) ? Object.values(nested) : [];
  return { kind: kinds.length === 1 ? kinds[0] : undefined, subs };
}

/**
 * Whether aggregations are numbers only, a builder's columns, at most so many.
 *
 * @param subs - The sub-aggregations.
 * @param most - The most a builder writes.
 * @returns Whether each computes one number with none of its own.
 */
function metricsOnly(subs: readonly unknown[], most: number): boolean {
  if (subs.length > most) return false;
  return subs.every((sub) => {
    const { kind, subs: own } = kindOf(sub);
    return kind !== undefined && metricKinds.has(kind) && own.length === 0;
  });
}

/**
 * The builder for an aggregation of buckets by a term, if a builder writes it.
 *
 * @param subs - The aggregations under it.
 * @returns The builder's id, or `undefined`.
 */
function builderOfTerms(subs: readonly unknown[]): string | undefined {
  if (metricsOnly(subs, 1)) return 'search-breakdown';
  return metricsOnly(subs, 8) ? 'search-table' : undefined;
}

/**
 * The builder for an aggregation of buckets in time, if a builder writes it: a series, split by
 * at most one term.
 *
 * @param subs - The aggregations under it.
 * @returns The builder's id, or `undefined`.
 */
function builderOfTime(subs: readonly unknown[]): string | undefined {
  const split = subs.length === 1 ? kindOf(subs[0]) : undefined;
  const values = split?.kind === 'terms' ? split.subs : subs;
  return metricsOnly(values, 1) ? 'search-series' : undefined;
}

/**
 * The builder for a body's one aggregation, if a builder writes it.
 *
 * @param aggregation - The aggregation.
 * @returns The builder's id, or `undefined`.
 */
function builderOfAggregation(aggregation: unknown): string | undefined {
  const { kind, subs } = kindOf(aggregation);
  if (kind === 'terms') return builderOfTerms(subs);
  if (kind === 'date_histogram') return builderOfTime(subs);
  if (kind === undefined || subs.length > 0) return undefined;
  if (kind === 'histogram') return 'search-histogram';
  return metricKinds.has(kind) ? 'search-stat' : undefined;
}

/**
 * Whether a body sends only keys and filters a builder writes.
 *
 * @param body - The body.
 * @returns Whether a builder could write it.
 */
function isPlainBody(body: unknown): body is Record<string, unknown> {
  if (!isObject(body) || Object.keys(body).some((key) => !bodyKeys.has(key))) return false;
  return body.query === undefined || isPlainClause(body.query);
}

/**
 * The builder that writes a search body, if one does.
 *
 * @param body - The body.
 * @returns The builder's id, or `undefined` for a body only a raw search can send.
 */
export function builderOfSearch(body: unknown): string | undefined {
  if (!isPlainBody(body)) return undefined;
  const aggregations = body.aggs ?? body.aggregations;
  if (aggregations === undefined) return body.size === 0 ? undefined : 'search-rows';
  const named = isObject(aggregations) ? Object.values(aggregations) : [];
  return named.length === 1 ? builderOfAggregation(named[0]) : undefined;
}

/**
 * A raw search's body, read from its text.
 *
 * @param text - The body as the edit gives it.
 * @returns The body, or `undefined` when it is not JSON.
 */
function bodyOf(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * The notes on an edit's raw searches that a builder writes.
 *
 * @param request - The edit.
 * @returns One note for each such panel.
 */
export function rawSearchNotes(request: Pick<EditRequest, 'panels'>): string[] {
  return request.panels.flatMap((panel) => {
    const { data } = panel;
    if (data.kind !== 'raw' || data.language !== 'search') return [];
    const builder = builderOfSearch(bodyOf(data.query));
    if (!builder) return [];
    return [
      `"${panel.title}" sends a raw search that the ${builder} builder writes. Next time build it with { "kind": "${builder}" }: the builder checks its fields and its buckets.`,
    ];
  });
}
