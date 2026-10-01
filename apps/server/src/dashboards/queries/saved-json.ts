/**
 * Saved queries whose text is the JSON of a template: a search's index and body, a MongoDB
 * collection and pipeline, an HTTP request. A placeholder is a whole string, `"{{name}}"`, or a
 * whole key; a variable value becomes a `{"$var": "name"}` node, never text in a string. Only an
 * HTTP request's path and query values take a placeholder inside text, where `$name` is their own
 * variable syntax.
 */
import type { QueryParamKind, SavedQuery } from '@quanthea/shared';
import { jsonObject } from './raw.ts';
import { QueryError, variableOf } from './text.ts';

/** A placeholder that is a whole string. */
const wholePlaceholder = /^\{\{\s*([a-z][a-z0-9_]*)\s*\}\}$/;

/** A placeholder anywhere in a string. */
const anyPlaceholder = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g;

/** A field path, such as `session.player.platform`. */
const fieldPath = /^@?[A-Za-z_][A-Za-z0-9_.@-]*$/;

/** An index, an index pattern or list, or a collection. */
const sourceName = /^[A-Za-z0-9_.*,-]{1,200}$/;

/** A duration, or an interval variable. */
const duration = /^(\d{1,5}[smhd]|\$[A-Za-z_]\w*)$/;

/** What filling needs: the template's placeholders and the values given. */
interface Filling {
  /** The saved query. */
  readonly template: SavedQuery;
  /** The values by placeholder. */
  readonly params: Readonly<Record<string, string>>;
}

/**
 * Checks a value against a pattern.
 *
 * @param value - The value.
 * @param pattern - The pattern.
 * @param what - What the value should be, for the error.
 * @returns The value.
 * @throws {QueryError} When it does not match.
 */
function checked(value: string, pattern: RegExp, what: string): string {
  if (!pattern.test(value)) throw new QueryError(`"${value}" is not ${what}.`);
  return value;
}

/**
 * A placeholder's kind and value.
 *
 * @param filling - The template and the values.
 * @param name - The placeholder.
 * @returns Its kind and value.
 * @throws {QueryError} When it has no value.
 */
function paramOf(filling: Filling, name: string): { kind: QueryParamKind; value: string } {
  const param = filling.template.params.find((each) => each.name === name);
  const value = filling.params[name];
  if (!param || value === undefined)
    throw new QueryError(`${filling.template.name} needs a value for ${name}.`);
  return { kind: param.kind, value };
}

/**
 * The JSON value a whole-string placeholder becomes.
 *
 * @param kind - Its kind.
 * @param value - The value given.
 * @returns A variable node, or a checked string.
 * @throws {QueryError} When the value does not fit its kind.
 */
function jsonValue(kind: QueryParamKind, value: string): unknown {
  const variable = variableOf(value);
  if (kind === 'value') return variable === undefined ? value : { $var: variable };
  if (kind === 'duration') {
    checked(value, duration, 'a duration such as 5m');
    return variable === undefined ? value : { $var: variable };
  }
  return jsonName(kind, value);
}

/**
 * The text a name placeholder becomes, as a value or a key.
 *
 * @param kind - Its kind.
 * @param value - The value given.
 * @returns The checked name.
 * @throws {QueryError} For a metric, or a name that does not fit.
 */
function jsonName(kind: QueryParamKind, value: string): string {
  if (kind === 'table') return checked(value, sourceName, 'an index or a collection');
  if (kind === 'label' || kind === 'column') return checked(value, fieldPath, 'a field name');
  throw new QueryError(`A ${kind} placeholder cannot name a field or a key here.`);
}

/**
 * The text a placeholder inside an HTTP path or query value becomes: a variable as `$name`, which
 * the HTTP binder fills, or the literal, encoded in a path.
 *
 * @param kind - Its kind.
 * @param value - The value given.
 * @param inPath - Whether it is in the path.
 * @returns The text.
 * @throws {QueryError} For a name kind, or a literal with a `$`.
 */
function httpText(kind: QueryParamKind, value: string, inPath: boolean): string {
  if (kind !== 'value' && kind !== 'duration')
    throw new QueryError(`A ${kind} placeholder cannot go in a path or a query value.`);
  if (variableOf(value)) return value;
  if (value.includes('$')) throw new QueryError(`"${value}" holds a $; use a variable instead.`);
  return inPath ? encodeURIComponent(value) : value;
}

/**
 * Fills a string node: a whole placeholder becomes a JSON value; inside text, only where HTTP takes
 * one.
 *
 * @param filling - The template and the values.
 * @param text - The string.
 * @param where - The keys from the root, to tell an HTTP path or query value.
 * @returns The filled value.
 * @throws {QueryError} For a placeholder inside text elsewhere.
 */
function fillString(filling: Filling, text: string, where: readonly string[]): unknown {
  const whole = wholePlaceholder.exec(text);
  if (whole) {
    const { kind, value } = paramOf(filling, whole[1] ?? '');
    return httpPart(filling, where)
      ? httpText(kind, value, where[0] === 'path')
      : jsonValue(kind, value);
  }
  if (!text.includes('{{')) return text;
  if (!httpPart(filling, where))
    throw new QueryError('Put a placeholder alone in its string: "{{name}}".');
  return text.replace(anyPlaceholder, (_match, name: string) => {
    const { kind, value } = paramOf(filling, name);
    return httpText(kind, value, where[0] === 'path');
  });
}

/**
 * Whether a string is an HTTP request's path or one of its query values.
 *
 * @param filling - The template.
 * @param where - The keys from the root.
 * @returns `true` there.
 */
function httpPart(filling: Filling, where: readonly string[]): boolean {
  if (filling.template.language !== 'http') return false;
  return (
    (where.length === 1 && where[0] === 'path') || (where.length === 2 && where[0] === 'query')
  );
}

/**
 * Fills a key: a whole placeholder becomes a checked name.
 *
 * @param filling - The template and the values.
 * @param key - The key.
 * @returns The filled key.
 * @throws {QueryError} For a placeholder inside a key.
 */
function fillKey(filling: Filling, key: string): string {
  const whole = wholePlaceholder.exec(key);
  if (whole) {
    const { kind, value } = paramOf(filling, whole[1] ?? '');
    return jsonName(kind, value);
  }
  if (key.includes('{{')) throw new QueryError('Put a placeholder alone in its key: "{{name}}".');
  return key;
}

/**
 * Fills a node and everything under it.
 *
 * @param filling - The template and the values.
 * @param node - The node.
 * @param where - The keys from the root.
 * @returns The filled node.
 */
function fillNode(filling: Filling, node: unknown, where: readonly string[]): unknown {
  if (typeof node === 'string') return fillString(filling, node, where);
  if (Array.isArray(node)) return node.map((item) => fillNode(filling, item, where));
  if (node === null || typeof node !== 'object') return node;
  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => [
      fillKey(filling, key),
      fillNode(filling, value, [...where, key]),
    ]),
  );
}

/**
 * A JSON saved query's template, its placeholders filled.
 *
 * @param template - The saved query.
 * @param params - The values by placeholder.
 * @returns The template's fields.
 * @throws {QueryError} When the text is not a JSON object, a placeholder has no value or a value
 *   does not fit.
 */
export function filledJson(
  template: SavedQuery,
  params: Readonly<Record<string, string>>,
): Record<string, unknown> {
  const document = jsonObject(template.query, `${template.name} query`);
  return fillNode({ template, params }, document, []) as Record<string, unknown>;
}
