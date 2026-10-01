/**
 * Binds the variables of a JSON document, structurally: a variable is a node of its own,
 * `{"$var": "service"}`, replaced by the value as a JSON value, never text inside a string.
 */
import { parseDuration } from './promql-binder.ts';
import { QueryError } from './query-error.ts';
import type { Variables } from './variables.ts';

/** What binding a document needs. */
export interface JsonBindContext {
  /** The variable values. */
  readonly variables: Variables;
  /** The built-in values, such as `__from`, by name, as JSON values. */
  readonly builtIns: Readonly<Record<string, unknown>>;
  /** Whether keys may start with `$`, as MongoDB operators do. Without it, such a key is refused. */
  readonly operatorKeys?: boolean;
  /**
   * Checks one key of an object, for what a language refuses.
   *
   * @param key - The key.
   * @throws {QueryError} When the language refuses it.
   */
  readonly checkKey?: (key: string) => void;
}

/** How deep a document may nest. */
const maxDepth = 64;

/** What a reference may ask its value as: a list, or a duration in milliseconds. */
const conversions = new Set(['list', 'ms']);

/**
 * Whether a node is a variable reference: `{"$var": "name"}`, `{"$var": "name", "as": "list"}`
 * for a list whatever the number of values, or `"as": "ms"` for a duration in milliseconds.
 *
 * @param node - The node.
 * @returns `true` for a well-formed reference.
 */
function wellFormed(node: Readonly<Record<string, unknown>>): boolean {
  const keys = Object.keys(node).sort().join(',');
  if (typeof node.$var !== 'string') return false;
  return keys === '$var' || (keys === '$var,as' && conversions.has(String(node.as)));
}

/**
 * The value of a `{"$var": "name"}` node: a built-in as it is, one value as a string, a
 * multi-value variable as a list. With `"as": "list"`, a list in every case.
 *
 * @param node - The node.
 * @param context - The variables and built-ins.
 * @returns The value.
 * @throws {QueryError} `invalid` for a node with other keys, or an unknown variable.
 */
function variableValue(node: Readonly<Record<string, unknown>>, context: JsonBindContext): unknown {
  if (!wellFormed(node)) {
    throw new QueryError(
      'invalid',
      'A variable is a node of its own: {"$var": "service"}, with "as": "list" or "ms" if needed.',
    );
  }
  const name = String(node.$var);
  const builtIn = context.builtIns[name];
  const value = builtIn ?? context.variables[name]?.value;
  if (value === undefined) throw new QueryError('invalid', `Unknown variable ${name}.`);
  if (node.as === 'ms') return millisecondsOf(name, value);
  if (Array.isArray(value)) return [...value];
  return node.as === 'list' ? [value] : value;
}

/**
 * A duration value in milliseconds: a number as it is (a built-in such as `__interval_ms`), or a
 * duration such as `5m`.
 *
 * @param name - The variable, for the message.
 * @param value - Its value.
 * @returns Milliseconds.
 * @throws {QueryError} `invalid` for a value that is not one duration.
 */
function millisecondsOf(name: string, value: unknown): number {
  if (typeof value === 'number') return value;
  const seconds = typeof value === 'string' ? parseDuration(value) : undefined;
  if (seconds === undefined)
    throw new QueryError('invalid', `${name} is not a duration such as 5m, so it has no "ms".`);
  return seconds * 1000;
}

/**
 * Binds one node and everything under it.
 *
 * @param node - The node.
 * @param context - The variables, built-ins and key check.
 * @param depth - How deep the node is.
 * @returns The bound node.
 * @throws {QueryError} `invalid` for a refused key, an unknown variable or nesting too deep.
 */
function bindNode(node: unknown, context: JsonBindContext, depth: number): unknown {
  if (depth > maxDepth) throw new QueryError('invalid', 'The query body nests too deep.');
  if (Array.isArray(node)) return node.map((item) => bindNode(item, context, depth + 1));
  if (node === null || typeof node !== 'object') return node;
  const object = node as Readonly<Record<string, unknown>>;
  if ('$var' in object) return variableValue(object, context);
  return Object.fromEntries(
    Object.entries(object).map(([key, value]) => {
      context.checkKey?.(key);
      if (key.startsWith('$') && !context.operatorKeys)
        throw new QueryError('invalid', `"${key}" is not a variable; write {"$var": "name"}.`);
      return [key, bindNode(value, context, depth + 1)];
    }),
  );
}

/**
 * Binds the variables of a JSON object.
 *
 * @param document - The object, with `{"$var": "name"}` nodes.
 * @param context - The variables, built-ins and key check.
 * @returns The object with every variable node replaced by its value.
 * @throws {QueryError} `invalid` for a refused key, an unknown variable or nesting too deep.
 */
export function bindJsonVariables(
  document: Readonly<Record<string, unknown>>,
  context: JsonBindContext,
): Record<string, unknown> {
  return bindNode(document, context, 0) as Record<string, unknown>;
}
