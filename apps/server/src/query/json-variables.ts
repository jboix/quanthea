/**
 * Binds the variables of a JSON document, structurally: a variable is a node of its own,
 * `{"$var": "service"}`, replaced by the value as a JSON value, never text inside a string.
 */
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

/**
 * Whether a node is a variable reference: `{"$var": "name"}`, or `{"$var": "name", "as": "list"}`
 * for a list whatever the number of values.
 *
 * @param node - The node.
 * @returns `true` for a well-formed reference.
 */
function wellFormed(node: Readonly<Record<string, unknown>>): boolean {
  const keys = Object.keys(node).sort().join(',');
  if (typeof node.$var !== 'string') return false;
  return keys === '$var' || (keys === '$var,as' && node.as === 'list');
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
      'A variable is a node of its own: {"$var": "service"}, or {"$var": "service", "as": "list"}.',
    );
  }
  const name = String(node.$var);
  const builtIn = context.builtIns[name];
  if (builtIn !== undefined) return node.as === 'list' ? [builtIn] : builtIn;
  const binding = context.variables[name];
  if (!binding) throw new QueryError('invalid', `Unknown variable ${name}.`);
  if (typeof binding.value !== 'string') return [...binding.value];
  return node.as === 'list' ? [binding.value] : binding.value;
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
