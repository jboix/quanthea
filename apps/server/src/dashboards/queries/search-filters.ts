/**
 * The filters of a search: one flat form, a field, an operator and what the operator takes. Filters
 * that share a name in `any` are alternatives: one of them must hold. The form is flat so its JSON
 * schema stays small in the edit tool's input, where every search builder holds it: what each
 * operator needs is checked here, in code. A variable becomes a `{"$var": "name"}` node, never
 * text in a string, and a value is always a JSON value of the body, never query text.
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

/** The most filters of one list. */
const maxFilters = 20;

/** What is said of an operator that is not one of the list. */
const operatorProblem = `An operator of a search filter is one of ${operators.map((op) => `"${op}"`).join(', ')}.`;

/**
 * A filter's operator, "=" when left out. It is a text checked against the list here and not an
 * enumeration of the schema: every search builder holds the filter form, some of them three
 * times, and the guide names the operators once.
 */
const operatorSchema = z
  .string()
  .default('=')
  .pipe(z.enum(operators, { error: operatorProblem }));

/** One filter of a search; which of `value` and `values` it needs depends on its operator. */
export const searchFilterSchema = z.strictObject({
  field: fieldPathSchema,
  op: operatorSchema,
  value: z.string().max(200).optional(),
  values: z.array(z.string().max(200)).min(1).max(50).optional(),
  any: z.string().min(1).max(40).optional(),
});

/** The filters of a search, all of which must hold, but for those that share a name in `any`. */
export const searchFiltersSchema = z.array(searchFilterSchema).max(maxFilters).default([]);

/** A filter of a search. */
export interface SearchFilter {
  /** The field. */
  readonly field: string;
  /** The operator. */
  readonly op: Operator;
  /** A literal, a pattern, a bound, or a variable such as `$platform`. */
  readonly value?: string | undefined;
  /** The list `in` takes: literals, or one variable alone. */
  readonly values?: readonly string[] | undefined;
  /** A name shared by the filters of which one must hold. */
  readonly any?: string | undefined;
}

/** A filter, checked: the field, the operator and what the operator takes. */
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
function partProblem(filter: SearchFilter, part: 'value' | 'values'): string | undefined {
  const needed = taken[filter.op];
  const given = filter[part] !== undefined;
  if (given === (part === needed)) return undefined;
  return given ? `takes ${takenText[needed ?? 'none']}, not "${part}"` : `needs "${part}"`;
}

/**
 * The parts of a filter, checked against its operator.
 *
 * @param filter - The filter.
 * @returns The field, the operator, and the value or the list.
 * @throws {QueryError} When the part the operator takes is missing, or a part it does not take is
 *   given. The message names the part.
 */
function partsOf(filter: SearchFilter): FilterParts {
  const { field, op } = filter;
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

/** The characters a wildcard pattern matches any text or any one character with. */
const wildcards = new Set(['*', '?']);

/** The most wildcards of a pattern written in a request: each one widens what the server reads. */
const maxWildcards = 4;

/**
 * A wildcard clause. A pattern written in the request starts with the text the values begin with:
 * one that starts with a wildcard, or is empty, makes the server read every value of the field,
 * so it is refused, and so is one with many wildcards. A variable is not read here: a person
 * fills it.
 *
 * @param parts - The filter.
 * @returns The clause.
 * @throws {QueryError} When a written pattern starts with `*` or `?`, is empty, or holds more
 *   than four wildcards.
 */
function wildcardClause(parts: FilterParts): Json {
  const first = parts.value.charAt(0);
  if (first === '' || wildcards.has(first)) {
    throw new QueryError(
      `The filter on ${parts.field} with "like" starts with a wildcard, which reads every value of the field: start the pattern with the text the values begin with, such as "urn:*". When the person asks for values that end with or contain a text, give them a text variable for the pattern.`,
    );
  }
  if ([...parts.value].filter((character) => wildcards.has(character)).length > maxWildcards) {
    throw new QueryError(
      `The filter on ${parts.field} with "like" holds more than ${maxWildcards} wildcards: write a shorter pattern, such as "urn:*".`,
    );
  }
  return { wildcard: { [parts.field]: { value: valueNode(parts.value, false) } } };
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
  like: wildcardClause,
  in: (parts) => ({ terms: { [parts.field]: listNode(parts) } }),
  exists: (parts) => ({ exists: { field: parts.field } }),
};

/** The operators whose value is a pattern or a bound, where a variable is the whole value. */
const wholeValueOperators: ReadonlySet<Operator> = new Set([
  '=~',
  '!~',
  '>',
  '>=',
  '<',
  '<=',
  'like',
]);

/** A variable reference somewhere in a text. */
const variableInText = /\$[A-Za-z_]\w*/;

/**
 * Refuses a pattern or a bound that holds a variable beside other text. Only a value that is the
 * variable alone becomes a variable: `$q*` would be sent as those three characters.
 *
 * @param parts - The filter.
 * @throws {QueryError} When the value names a variable and is not that variable alone.
 */
function checkWholeVariable(parts: FilterParts): void {
  if (!wholeValueOperators.has(parts.op) || variableOf(parts.value) !== undefined) return;
  const [reference] = variableInText.exec(parts.value) ?? [];
  if (reference === undefined) return;
  throw new QueryError(
    `The filter on ${parts.field} with "${parts.op}" holds ${reference} beside other text, which is sent as that text, not as the variable. A variable is the whole value: "${reference}", and the person writes the rest in it.`,
  );
}

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
 * The clause of one filter.
 *
 * @param filter - The filter.
 * @returns The clause, and whether it is negated.
 * @throws {QueryError} When the filter lacks a part its operator needs, holds one too many, or
 *   holds a variable beside other text in a pattern or a bound.
 */
function written(filter: SearchFilter): WrittenFilter {
  const parts = partsOf(filter);
  checkWholeVariable(parts);
  return { negated: negatedOperators.has(parts.op), clause: clauses[parts.op](parts) };
}

/**
 * The clause of the filters that share a name in `any`: a bool query of which one must hold.
 *
 * @param name - The name they share.
 * @param alternatives - The filters.
 * @returns The clause.
 * @throws {QueryError} When one filter alone has the name.
 */
function anyClause(name: string, alternatives: readonly SearchFilter[]): Json {
  if (alternatives.length < 2) {
    throw new QueryError(
      `One filter alone has "any": "${name}". Give the same "any" to each of the filters of which one must hold, or leave it out.`,
    );
  }
  const should = alternatives.map(written).map(({ negated, clause }) => {
    return negated ? { bool: { must_not: [clause] } } : clause;
  });
  return { bool: { should, minimum_should_match: 1 } };
}

/**
 * The clauses of filters: each filter's own, and one for each name in `any`, where the first
 * filter of that name stands.
 *
 * @param filters - The filters.
 * @returns The clauses, in the filters' order.
 * @throws {QueryError} When a filter lacks a part its operator needs, or is alone in its `any`.
 */
function writtenAll(filters: readonly SearchFilter[]): WrittenFilter[] {
  return filters.flatMap((filter) => {
    if (filter.any === undefined) return [written(filter)];
    const alternatives = filters.filter((other) => other.any === filter.any);
    if (alternatives[0] !== filter) return [];
    return [{ negated: false, clause: anyClause(filter.any, alternatives) }];
  });
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
  if (filters.length > maxFilters) {
    throw new QueryError(`A search takes ${maxFilters} filters at most.`);
  }
  const all = writtenAll(filters);
  const must = [...extra, ...all.filter(({ negated }) => !negated).map(({ clause }) => clause)];
  const mustNot = all.filter(({ negated }) => negated).map(({ clause }) => clause);
  const bool = mustNot.length === 0 ? { filter: must } : { filter: must, must_not: mustNot };
  return must.length === 0 && mustNot.length === 0 ? { match_all: {} } : { bool };
}
