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

/**
 * Whether a value is the options of one column: an object naming its field.
 *
 * @param value - One entry of `options.columns`.
 * @returns Whether it names a field.
 */
function isColumnOption(value: Json): value is JsonObject & { field: string } {
  return isJsonObject(value) && typeof value.field === 'string' && value.field !== '';
}

/**
 * The problem of options for fields the table does not show.
 *
 * @param unknown - The fields that are not columns.
 * @param names - The table's columns.
 * @returns The sentence, naming the fields and the columns.
 */
function unknownProblem(unknown: readonly string[], names: readonly string[]): string {
  const quoted = (list: readonly string[]) => list.map((name) => `"${name}"`).join(', ');
  return `options.columns names ${quoted(unknown)}, which the table does not show. Its columns are ${quoted(names)}: name a column to show in roles.columns.`;
}

/**
 * The columns of a table view, in the order of the roles, each merged with the options given for
 * its field. Before the roles are known the options are the only columns named, so they are kept
 * as they come.
 *
 * @param names - The columns the roles name, in order: empty while they are not known.
 * @param asked - The recipe option's `columns`, if any.
 * @returns The columns, or the problem of options that are not a list of columns or that name a
 *   field the table does not show.
 */
export function tableColumns(names: readonly string[], asked: Json | undefined): TableColumns {
  if (asked === undefined) return { columns: names.map((field) => ({ field })) };
  if (!Array.isArray(asked) || !asked.every(isColumnOption)) return { problems: [shapeProblem] };
  if (names.length === 0) return { columns: asked };
  const unknown = asked.map((option) => option.field).filter((field) => !names.includes(field));
  if (unknown.length > 0) return { problems: [unknownProblem([...new Set(unknown)], names)] };
  const columns = names.map((field) =>
    asked
      .filter((option) => option.field === field)
      .reduce<JsonObject>((column, option) => ({ ...column, ...option }), { field }),
  );
  return { columns };
}
