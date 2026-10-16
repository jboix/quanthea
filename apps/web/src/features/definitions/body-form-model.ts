/**
 * The checked filters of a definition as a form: a language, a shape, where the rows come from,
 * the filters, the part of a ratio and what a measure measures. The form writes the builder
 * request, and reads one back when the request is one it can show; any other stays as JSON.
 */
import type { DefinitionBody, DefinitionShape } from '@quanthea/shared';

/** The filter operators, in the form's words. */
export const filterOps = [
  { op: '=', words: 'is' },
  { op: '!=', words: 'is not' },
  { op: '=~', words: 'matches' },
  { op: '!~', words: 'does not match' },
] as const;

/** A filter operator. */
export type FilterOp = (typeof filterOps)[number]['op'];

/** One filter row of the form. */
export interface FilterDraft {
  readonly field: string;
  readonly op: FilterOp;
  readonly value: string;
}

/** How the form writes the builders of one language. */
interface FormLanguage {
  /** The language's name on screen. */
  readonly label: string;
  /** The request field that names where the rows come from. */
  readonly source: 'table' | 'index' | 'collection' | 'metric';
  /** What that field is called on screen. */
  readonly sourceLabel: string;
  /** The builder of a measure or a segment. */
  readonly stat: string;
  /** The builder of a ratio. */
  readonly ratio: string;
  /** The measure's field that names a column, when the language measures one. */
  readonly column?: 'column' | 'field';
  /** The measures it takes, the count first. */
  readonly fns: readonly string[];
}

/** The languages the form writes, by query language. */
export const formLanguages = {
  sql: {
    label: 'SQL',
    source: 'table',
    sourceLabel: 'Table',
    stat: 'sql-stat',
    ratio: 'sql-ratio',
    column: 'column',
    fns: ['count', 'sum', 'avg', 'min', 'max', 'count_distinct'],
  },
  search: {
    label: 'Elasticsearch or OpenSearch',
    source: 'index',
    sourceLabel: 'Index',
    stat: 'search-stat',
    ratio: 'search-ratio',
    column: 'field',
    fns: ['count', 'sum', 'avg', 'min', 'max', 'cardinality'],
  },
  mongodb: {
    label: 'MongoDB',
    source: 'collection',
    sourceLabel: 'Collection',
    stat: 'mongodb-stat',
    ratio: 'mongodb-ratio',
    column: 'field',
    fns: ['count', 'sum', 'avg', 'min', 'max', 'count_distinct'],
  },
  promql: {
    label: 'PromQL',
    source: 'metric',
    sourceLabel: 'Metric',
    stat: 'gauge',
    ratio: 'ratio',
    fns: [],
  },
} as const satisfies Readonly<Record<string, FormLanguage>>;

/** A language the form writes. */
export type FormLanguageId = keyof typeof formLanguages;

/** The form's fields for one body. */
export interface BodyDraft {
  readonly language: FormLanguageId;
  readonly shape: DefinitionShape;
  /** Where the rows come from: a table, an index, a collection or a metric. */
  readonly source: string;
  /** The filters every row keeps; for a ratio, the whole. */
  readonly filters: readonly FilterDraft[];
  /** For a ratio, the filters of the part. */
  readonly part: readonly FilterDraft[];
  /** For a measure, its function. */
  readonly fn: string;
  /** For a measure other than a count, the column or field it measures. */
  readonly column: string;
}

/**
 * An empty form for a language.
 *
 * @param language - The language.
 * @returns The form, a ratio by default.
 */
export function emptyDraft(language: FormLanguageId): BodyDraft {
  return { language, shape: 'ratio', source: '', filters: [], part: [], fn: 'count', column: '' };
}

/**
 * The filled filter rows, as a request holds them.
 *
 * @param rows - The rows.
 * @returns The filters with a field.
 */
function filtersOf(rows: readonly FilterDraft[]) {
  return rows
    .filter((row) => row.field.trim() !== '')
    .map((row) => ({ field: row.field.trim(), op: row.op, value: row.value }));
}

/**
 * What a measure measures, as its request holds it.
 *
 * @param draft - The form.
 * @param language - How its language writes builders.
 * @returns The measure, or nothing when the language takes none.
 */
function measureOf(draft: BodyDraft, language: FormLanguage) {
  if (!language.column || draft.shape !== 'measure') return {};
  const column = draft.column.trim();
  const measured = draft.fn === 'count' || column === '' ? {} : { [language.column]: column };
  return { measure: { fn: draft.fn, ...measured } };
}

/**
 * The body the form describes.
 *
 * @param draft - The form.
 * @returns The body.
 */
export function bodyOfDraft(draft: BodyDraft): DefinitionBody {
  const language: FormLanguage = formLanguages[draft.language];
  const kind = draft.shape === 'ratio' ? language.ratio : language.stat;
  const part = draft.shape === 'ratio' ? { match: filtersOf(draft.part) } : {};
  const request = {
    kind,
    [language.source]: draft.source.trim(),
    filters: filtersOf(draft.filters),
    ...part,
    ...measureOf(draft, language),
  };
  return { shape: draft.shape, request };
}

/**
 * Filter rows from a request's filters, when every one is a plain filter.
 *
 * @param value - The request's filters.
 * @returns The rows, or `undefined` when one is not a filter the form shows.
 */
function rowsOf(value: unknown): FilterDraft[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return undefined;
  const rows = value.map((each) => {
    const { field, op = '=', value: wanted } = (each ?? {}) as Record<string, unknown>;
    const known = filterOps.some((item) => item.op === op);
    if (typeof field !== 'string' || typeof wanted !== 'string' || !known) return undefined;
    return { field, op: op as FilterOp, value: wanted };
  });
  return rows.every((row) => row !== undefined) ? rows : undefined;
}

/** The request fields the form writes, besides the source. */
const formFields = new Set(['kind', 'filters', 'match', 'measure']);

/**
 * The form a body's request fills, when the form can show it.
 *
 * @param body - The body.
 * @returns The form, or `undefined` for a request the form does not write.
 */
export function draftOfBody(body: DefinitionBody): BodyDraft | undefined {
  const entry = Object.entries(formLanguages).find(([, language]) =>
    [language.stat, language.ratio].some((kind) => kind === body.request.kind),
  );
  if (!entry || body.connectors) return undefined;
  const [id, language] = entry as [FormLanguageId, FormLanguage];
  const request = body.request as Readonly<Record<string, unknown>>;
  const other = Object.keys(request).some((key) => key !== language.source && !formFields.has(key));
  const filters = rowsOf(request.filters);
  const part = rowsOf(request.match);
  const measure = (request.measure ?? {}) as { fn?: unknown } & Record<string, unknown>;
  if (other || !filters || !part || typeof request[language.source] !== 'string') return undefined;
  const column = language.column ? measure[language.column] : undefined;
  return {
    language: id,
    shape: body.shape,
    source: String(request[language.source]),
    filters,
    part,
    fn: typeof measure.fn === 'string' ? measure.fn : 'count',
    column: typeof column === 'string' ? column : '',
  };
}
