/**
 * The filters of a search: one flat form, a field, an operator and what the operator takes, or
 * `any`, a list of such filters of which one must hold. The form is flat so its JSON schema stays
 * small: what each operator needs is checked here, in code. A variable becomes a `{"$var": "name"}`
 * node, never text in a string, and a value is always a JSON value of the body, never query text.
 *
 * The builders' requests still take the four operators of `pathFilterSchema`, which this form
 * reads as it is. The schema here is not in the edit tool's input yet: inlined in every search
 * builder it has to fit under the ceilings of `agent/edit-schema-size.test.ts`.
 */
import { z } from 'zod';
import { fieldPathSchema } from './fields.ts';
import { QueryError, variableOf } from './text.ts';

/** A JSON object of a search body. */
type Json = Record<string, unknown>;

/**
 * What a filter compares with: equal, not equal, matching or not a regular expression, above or
 * below a bound, a wildcard pattern (`like`), one of a list (`in`), or having a value (`exists`).
 */
const operators = ['=', '!=', '=~', '!~', '>', '>=', '<', '<=', 'like', 'in', 'exists'] as const;

/** A filter's operator. */
type Operator = (typeof operators)[number];

/** The most filters of one list, counting those inside `any`. */
const maxFilters = 20;

/** What a filter on one field may hold; which parts it needs depends on its operator. */
const leafShape = {
  field: fieldPathSchema.optional(),
  op: z.enum(operators).default('='),
  value: z.string().max(200).optional(),
  values: z.array(z.string().max(200)).min(1).max(50).optional(),
};

/** One filter of a search: a filter on a field, or `any`, of which one must hold. */
export const searchFilterSchema = z.strictObject({
  ...leafShape,
  any: z.array(z.strictObject(leafShape)).min(2).max(10).optional(),
});

/** The filters of a search, all of which must hold. */
export const searchFiltersSchema = z.array(searchFilterSchema).max(maxFilters).default([]);

/** A filter on one field. */
interface SearchLeafFilter {
  /** The field. */
  readonly field?: string | undefined;
  /** The operator. */
  readonly op: Operator;
  /** A literal, a pattern, a bound, or a variable such as `$platform`. */
  readonly value?: string | undefined;
  /** The list `in` takes: literals, or one variable alone. */
  readonly values?: readonly string[] | undefined;
}

/** A filter of a search. */
export interface SearchFilter extends SearchLeafFilter {
  /** Filters of which one must hold, in place of a field. */
  readonly any?: readonly SearchLeafFilter[] | undefined;
}

/** A filter on one field, checked: the field, the operator and what the operator takes. */
interface FilterParts {
  /** The field. */
  readonly field: string;
  /** The operator. */
  readonly op: Operator;
  /** The value, when the operator takes one. */
  readonly value: string;
  /** The list, when the operator takes one. */
  readonly values: readonly string[];
}

/** Which part each operator takes; `exists` takes none. */
const taken: Readonly<Record<Operator, 'value' | 'values' | undefined>> = {
  '=': 'value',
  '!=': 'value',
  '=~': 'value',
  '!~': 'value',
  '>': 'value',
  '>=': 'value',
  '<': 'value',
  '<=': 'value',
  like: 'value',
  in: 'values',
  exists: undefined,
};

/** How each part an operator may take reads in a message. */
const takenText = {
  value: 'one "value" ("in" takes a list)',
  values: 'a list in "values"',
  none: 'no value',
} as const;

/**
 * What is wrong with one part of a filter, given its operator.
 *
 * @param filter - The filter.
 * @param part - The part: `value` or `values`.
 * @returns The problem, such as `needs "values"`, or `undefined` when the part is as it should be.
 */
function partProblem(filter: SearchLeafFilter, part: 'value' | 'values'): string | undefined {
  const needed = taken[filter.op];
  const given = filter[part] !== undefined;
  if (given === (part === needed)) return undefined;
  return given ? `takes ${takenText[needed ?? 'none']}, not "${part}"` : `needs "${part}"`;
}

/**
 * The parts of a filter on one field, checked against its operator.
 *
 * @param filter - The filter.
 * @returns The field, the operator, and the value or the list.
 * @throws {QueryError} When the field is missing, or the part the operator takes is missing, or a
 *   part it does not take is given. The message names the part.
 */
function partsOf(filter: SearchLeafFilter): FilterParts {
  const { field, op } = filter;
  if (field === undefined) throw new QueryError(`A filter with "${op}" needs "field".`);
  const problem = partProblem(filter, 'value') ?? partProblem(filter, 'values');
  if (problem) throw new QueryError(`The filter on ${field} with "${op}" ${problem}.`);
  return { field, op, value: filter.value ?? '', values: filter.values ?? [] };
}

/**
 * One value of a body: the literal, or a variable node. Where a list goes the node asks for a
 * list, so one value or several both work. Elsewhere it asks for one value, so a multi-value
 * variable is refused when the query is bound, and so when the dashboard is checked: a search
 * server refuses a list in a pattern or a bound.
 *
 * @param value - Such as `ERROR` or `$platform`.
 * @param list - Whether the value sits where a list goes.
 * @returns The JSON value.
 */
function valueNode(value: string, list: boolean): unknown {
  const variable = variableOf(value);
  if (variable === undefined) return value;
  return { $var: variable, as: list ? 'list' : 'one' };
}

/**
 * The list of an `in`: its literals, or its one variable as a list, so a multi-value variable works.
 *
 * @param parts - The filter.
 * @returns The JSON value.
 * @throws {QueryError} When a variable stands among other values.
 */
function listNode(parts: FilterParts): unknown {
  const [first] = parts.values;
  if (parts.values.every((value) => variableOf(value) === undefined)) return [...parts.values];
  if (parts.values.length === 1 && first !== undefined) return valueNode(first, true);
  throw new QueryError(
    `The filter on ${parts.field} mixes a variable with other values in "values": give the variable alone, or each alternative in "any".`,
  );
}

/**
 * An equality clause: `terms` for a variable, which may hold several values, else `term`.
 *
 * @param parts - The filter.
 * @returns The clause.
 */
function equalClause(parts: FilterParts): Json {
  if (variableOf(parts.value)) return { terms: { [parts.field]: valueNode(parts.value, true) } };
  return { term: { [parts.field]: parts.value } };
}

/**
 * A writer of range clauses with one bound. The bound is a JSON string, which the server reads as
 * the field's type: a number for a numeric field, a date for a date field.
 *
 * @param bound - The bound's key, such as `gte`.
 * @returns The writer.
 */
function rangeClause(bound: string): (parts: FilterParts) => Json {
  return (parts) => ({ range: { [parts.field]: { [bound]: valueNode(parts.value, false) } } });
}

/**
 * A regular expression clause.
 *
 * @param parts - The filter.
 * @returns The clause.
 */
function regexpClause(parts: FilterParts): Json {
  return { regexp: { [parts.field]: valueNode(parts.value, false) } };
}

/** The positive clause each operator writes; a negated operator's clause goes in `must_not`. */
const clauses: Readonly<Record<Operator, (parts: FilterParts) => Json>> = {
  '=': equalClause,
  '!=': equalClause,
  '=~': regexpClause,
  '!~': regexpClause,
  '>': rangeClause('gt'),
  '>=': rangeClause('gte'),
  '<': rangeClause('lt'),
  '<=': rangeClause('lte'),
  like: (parts) => ({ wildcard: { [parts.field]: { value: valueNode(parts.value, false) } } }),
  in: (parts) => ({ terms: { [parts.field]: listNode(parts) } }),
  exists: (parts) => ({ exists: { field: parts.field } }),
};

/** The operators whose clause must not hold. */
const negatedOperators: ReadonlySet<Operator> = new Set(['!=', '!~']);

/** A filter as a clause, and whether the clause must not hold. */
interface WrittenFilter {
  /** Whether the clause must not hold. */
  readonly negated: boolean;
  /** The clause. */
  readonly clause: Json;
}

/**
 * The clause of a filter on one field.
 *
 * @param filter - The filter.
 * @returns The clause, and whether it is negated.
 * @throws {QueryError} When the filter lacks a part its operator needs.
 */
function writtenLeaf(filter: SearchLeafFilter): WrittenFilter {
  const parts = partsOf(filter);
  return { negated: negatedOperators.has(parts.op), clause: clauses[parts.op](parts) };
}

/**
 * The clause of an `any`: a bool query of which one alternative must hold.
 *
 * @param filter - The filter, for what it holds beside `any`.
 * @param any - The alternatives.
 * @returns The clause.
 * @throws {QueryError} When the filter also holds a field, an operator or a value of its own, or
 *   `any` holds fewer than two filters.
 */
function anyClause(filter: SearchFilter, any: readonly SearchLeafFilter[]): Json {
  const own = [filter.field, filter.value, filter.values].some((part) => part !== undefined);
  if (own || filter.op !== '=') {
    throw new QueryError(
      'A filter with "any" takes nothing else: "field", "op", "value" and "values" go inside "any".',
    );
  }
  if (any.length < 2) throw new QueryError('"any" takes two filters or more.');
  const should = any.map(writtenLeaf).map(({ negated, clause }) => {
    return negated ? { bool: { must_not: [clause] } } : clause;
  });
  return { bool: { should, minimum_should_match: 1 } };
}

/**
 * The clause of one filter.
 *
 * @param filter - The filter.
 * @returns The clause, and whether it is negated.
 * @throws {QueryError} When the filter lacks a part its operator needs, or holds one too many.
 */
function written(filter: SearchFilter): WrittenFilter {
  if (filter.any === undefined) return writtenLeaf(filter);
  return { negated: false, clause: anyClause(filter, filter.any) };
}

/**
 * Filters as a bool query: the positive ones in `filter`, in their order, the negated ones in
 * `must_not`.
 *
 * @param filters - The filters.
 * @param extra - Clauses that must also hold, such as the time range.
 * @returns The query.
 * @throws {QueryError} When a filter lacks a part its operator needs, or there are over twenty.
 */
export function boolQuery(filters: readonly SearchFilter[], extra: readonly Json[] = []): Json {
  const count = filters.reduce((sum, filter) => sum + (filter.any?.length ?? 1), 0);
  if (count > maxFilters) {
    throw new QueryError(`A search takes ${maxFilters} filters at most, counting those in "any".`);
  }
  const all = filters.map(written);
  const must = [...extra, ...all.filter(({ negated }) => !negated).map(({ clause }) => clause)];
  const mustNot = all.filter(({ negated }) => negated).map(({ clause }) => clause);
  const bool = mustNot.length === 0 ? { filter: must } : { filter: must, must_not: mustNot };
  return must.length === 0 && mustNot.length === 0 ? { match_all: {} } : { bool };
}
