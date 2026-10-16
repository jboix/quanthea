/**
 * A definition's checked body in plain words, such as "the orders where status is failed, over
 * every order": what it counts and where, for people who do not read builder requests.
 */
import { bodyLanguage, type DefinitionBody, queryLanguageNames } from '@quanthea/shared';

/** A filter as a body holds it. */
interface FilterLike {
  readonly field?: unknown;
  readonly op?: unknown;
  readonly value?: unknown;
}

/** The words of each filter operator. */
const opWords: Readonly<Record<string, string>> = {
  '=': 'is',
  '!=': 'is not',
  '=~': 'matches',
  '!~': 'does not match',
};

/** The words of each measure. */
const measureWords: Readonly<Record<string, string>> = {
  count: 'the number',
  sum: 'the sum',
  avg: 'the average',
  min: 'the lowest',
  max: 'the highest',
  count_distinct: 'the number of distinct values',
};

/**
 * One filter in words, such as `status is "failed"`.
 *
 * @param filter - The filter.
 * @returns The words.
 */
function filterWords(filter: FilterLike): string {
  const op = opWords[typeof filter.op === 'string' ? filter.op : '='] ?? String(filter.op);
  return `${String(filter.field)} ${op} "${String(filter.value ?? '')}"`;
}

/**
 * Filters in words, joined with "and".
 *
 * @param value - The filters, as the request holds them.
 * @returns The words, or an empty string for none.
 */
export function filtersWords(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return (value as FilterLike[]).map(filterWords).join(' and ');
}

/**
 * Where a body's rows come from: its table, index, collection, metric or log stream.
 *
 * @param request - The body's request.
 * @returns Such as `orders`.
 */
export function sourceOf(request: Readonly<Record<string, unknown>>): string {
  const named = request.table ?? request.index ?? request.collection ?? request.metric;
  if (typeof named === 'string' && named !== '') return named;
  const stream = filtersWords(request.stream);
  return stream === '' ? 'the data' : `the logs where ${stream}`;
}

/**
 * A set of rows in words: the source, then its filters.
 *
 * @param source - Where the rows come from.
 * @param filters - The filters, in words.
 * @returns Such as `orders where status is "failed"`.
 */
function rowsWords(source: string, filters: string): string {
  return filters === '' ? `every row of ${source}` : `${source} where ${filters}`;
}

/**
 * What a measure body measures, in words.
 *
 * @param request - The body's request.
 * @returns Such as `the sum of total_cents`.
 */
function measured(request: Readonly<Record<string, unknown>>): string {
  const measure = request.measure as
    | { fn?: unknown; column?: unknown; field?: unknown }
    | undefined;
  const fn = typeof measure?.fn === 'string' ? measure.fn : 'count';
  const column = measure?.column ?? measure?.field;
  const what = measureWords[fn] ?? fn;
  if (typeof column === 'string') return `${what} of ${column}`;
  return fn === 'count' ? 'the number of rows' : what;
}

/**
 * A body in words: what it counts or measures, over which rows.
 *
 * @param body - The body.
 * @returns The sentence.
 */
export function bodyWords(body: DefinitionBody): string {
  const request = body.request as Readonly<Record<string, unknown>>;
  const source = sourceOf(request);
  const filters = filtersWords(request.filters);
  if (body.shape === 'ratio') {
    const whole = [filters, filtersWords(request.of)].filter(Boolean).join(' and ');
    const part = [whole, filtersWords(request.match)].filter(Boolean).join(' and ');
    const negated = request.complement === true ? 'One minus the share' : 'The share';
    return `${negated} of ${rowsWords(source, part)}, out of ${rowsWords(source, whole)}.`;
  }
  if (body.shape === 'segment') return `Only ${rowsWords(source, filters)}.`;
  const what = measured(request);
  return `${what.charAt(0).toUpperCase()}${what.slice(1)} over ${rowsWords(source, filters)}.`;
}

/**
 * Where a body applies, in words.
 *
 * @param body - The body.
 * @returns Such as `SQL, on postgres-orders` or `PromQL, on every PromQL connector`.
 */
export function bodyPlace(body: DefinitionBody): string {
  const language = queryLanguageNames[bodyLanguage(body)];
  const where = body.connectors?.join(', ') ?? `every ${language} connector`;
  return `${language}, on ${where}`;
}
