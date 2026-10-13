/**
 * The columns of a table view: the columns its roles name, each with what the agent's options say
 * about it. The options never choose the columns, so a column the agent does not repeat stays.
 */
import { isJsonObject, type Json, type JsonObject } from './merge.ts';

/** The columns of a table, or what is wrong with the options given for them. */
export type TableColumns = { columns: JsonObject[] } | { problems: string[] };

/** What the options of a table's columns must be. */
const shapeProblem =
  'options.columns is a list of { "field", "label"?, "format"?, "align"? }, one for each column to change.';

/** What the options of one column may hold. */
const optionKeys: ReadonlySet<string> = new Set(['field', 'label', 'format', 'align']);

/**
 * Whether a value is the options of one column: an object naming its field, with nothing a column
 * does not take.
 *
 * @param value - One entry of `options.columns`.
 * @returns Whether it names a field and holds only what a column takes.
 */
function isColumnOption(value: Json): value is JsonObject & { field: string } {
  if (!isJsonObject(value) || typeof value.field !== 'string' || value.field === '') return false;
  return Object.keys(value).every((key) => optionKeys.has(key));
}

/**
 * A list of names, quoted.
 *
 * @param list - The names.
 * @returns Such as `"host", "errors"`.
 */
function quoted(list: readonly string[]): string {
  return list.map((name) => `"${name}"`).join(', ');
}

/**
 * The problem of options for fields the table does not show.
 *
 * @param unknown - The fields that are not columns.
 * @param names - The table's columns.
 * @returns The sentence, naming the fields and the columns.
 */
function unknownProblem(unknown: readonly string[], names: readonly string[]): string {
  return `options.columns names ${quoted(unknown)}, which the table does not show. Its columns are ${quoted(names)}: name a column to show in roles.columns.`;
}

/** The columns a table shows, and whether the chart named them. */
export interface ShownColumns {
  /** The columns of the roles, in order: empty while they are not known. */
  readonly names: readonly string[];
  /** Whether the chart named them in `roles.columns`, and they are not the result's own. */
  readonly named: boolean;
}

/**
 * The problem of options that list every column of a result in another order, with no column
 * named in the roles: the options would look like they order the table, and they do not.
 *
 * @param fields - The fields the options name, in their order.
 * @param shown - The table's columns.
 * @returns The sentence, or `undefined` when the options ask for no other order.
 */
function orderProblem(fields: readonly string[], shown: ShownColumns): string | undefined {
  const { names, named } = shown;
  const asked = [...new Set(fields)];
  if (named || asked.length !== names.length) return undefined;
  if (asked.every((field, index) => field === names[index])) return undefined;
  return `options.columns lists the columns as ${quoted(asked)}, and the table shows them as ${quoted(names)}: options.columns does not order them. Name the columns in roles.columns, in the order to show.`;
}

/**
 * The columns of a table view, in the order of the roles, each merged with the options given for
 * its field. Before the roles are known the options are the only columns named, so they are kept
 * as they come until the chart is completed.
 *
 * @param shown - The columns the roles name, without repeats, and whether the chart named them.
 * @param asked - The recipe option's `columns`, if any.
 * @returns The columns, or the problem of options that are not a list of columns, that name a
 *   field the table does not show, or that list every column in another order.
 */
export function tableColumns(shown: ShownColumns, asked: Json | undefined): TableColumns {
  const names = [...new Set(shown.names)];
  if (asked === undefined) return { columns: names.map((field) => ({ field })) };
  if (!Array.isArray(asked) || !asked.every(isColumnOption)) return { problems: [shapeProblem] };
  if (names.length === 0) return { columns: asked };
  const fields = asked.map((option) => option.field);
  const unknown = fields.filter((field) => !names.includes(field));
  if (unknown.length > 0) return { problems: [unknownProblem([...new Set(unknown)], names)] };
  const order = orderProblem(fields, { ...shown, names });
  if (order) return { problems: [order] };
  const columns = names.map((field): JsonObject => {
    const options = asked.filter((option) => option.field === field);
    return Object.assign({ field }, ...options);
  });
  return { columns };
}
