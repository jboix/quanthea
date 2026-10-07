/**
 * Binds variables into an HTTP template. In the path, `$name` becomes its value URL-encoded, one
 * value only, so it stays one segment. In a query parameter it becomes the raw value, which the
 * request encodes, and a parameter that is only a multi-value variable repeats once per value. The
 * body takes `{"$var": "name"}` nodes. Headers take no variable.
 */
import type { HttpField, HttpQuery, TimeRange } from '../connectors/_shared/index.ts';
import { bindJsonVariables } from './json-variables.ts';
import { QueryError } from './query-error.ts';
import { type Variables, valuesOf } from './variables.ts';

/** The HTTP template of a panel query. */
export interface HttpTemplate {
  /** `GET` or `POST`. */
  readonly method: 'GET' | 'POST';
  /** The path under the connector's base URL, with `$name` variables. */
  readonly path: string;
  /** The query parameters, whose values may hold `$name` variables. */
  readonly query?: Readonly<Record<string, string>> | undefined;
  /** The JSON body of a POST, with `{"$var": "name"}` nodes. */
  readonly body?: Readonly<Record<string, unknown>> | undefined;
  /** How the response becomes a table. */
  readonly extract: { readonly rows: string; readonly fields?: readonly HttpField[] | undefined };
}

/** A `$name` or `${name}` reference. */
const reference = /\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g;

/** A parameter value that is one reference and nothing else. */
const onlyReference = /^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))$/;

/**
 * A path the binder accepts: absolute, without a query, a fragment, a backslash or a control
 * character (URL parsing drops tab and newlines, which would join `.\t.` into `..`).
 */
const pathShape = /^\/(?!\/)[^?#\\\p{Cc}]*$/u;

/** A dot segment as URL parsing reads it: `.` or `..`, each dot also written `%2e`. */
const dotSegment = /^(?:\.|%2e){1,2}$/i;

/** Why a path is refused. */
const pathRule =
  'A path starts with /, holds no ?, # or \\, no control character and no . or .. segment: ' +
  'put parameters in "query".';

/**
 * Whether a path holds a dot segment, which URL parsing would resolve against its parent.
 *
 * @param path - The path, encoded.
 * @returns `true` when a segment is `.` or `..`, in any encoding of the dots.
 */
function hasDotSegment(path: string): boolean {
  return path.split('/').some((segment) => dotSegment.test(segment));
}

/**
 * The built-in values: the time range as ISO times, epoch milliseconds and epoch seconds.
 *
 * @param timeRange - The time range.
 * @returns The values by name.
 */
function builtInsOf(timeRange: TimeRange): Readonly<Record<string, string>> {
  const { from, to } = timeRange;
  return {
    __from: from.toISOString(),
    __to: to.toISOString(),
    __from_ms: String(from.getTime()),
    __to_ms: String(to.getTime()),
    __from_s: String(Math.floor(from.getTime() / 1000)),
    __to_s: String(Math.floor(to.getTime() / 1000)),
  };
}

/** What substituting a reference needs. */
interface Values {
  /** The variable values. */
  readonly variables: Variables;
  /** The built-in values. */
  readonly builtIns: Readonly<Record<string, string>>;
}

/**
 * The values of a reference.
 *
 * @param name - The variable name.
 * @param values - The variables and built-ins.
 * @returns Its values.
 * @throws {QueryError} `invalid` for an unknown variable.
 */
function valuesFor(name: string, values: Values): readonly string[] {
  const builtIn = values.builtIns[name];
  if (builtIn !== undefined) return [builtIn];
  const binding = values.variables[name];
  if (!binding) throw new QueryError('invalid', `Unknown variable $${name}.`);
  return valuesOf(binding);
}

/**
 * Replaces every reference of a text with its one value.
 *
 * @param text - The text.
 * @param values - The variables and built-ins.
 * @param encode - Encodes a value for where it goes.
 * @returns The text with the values.
 * @throws {QueryError} `invalid` for an unknown variable or one with several values.
 */
function substitute(text: string, values: Values, encode: (value: string) => string): string {
  return text.replace(reference, (_match, braced?: string, bare?: string) => {
    const name = braced ?? bare ?? '';
    const found = valuesFor(name, values);
    if (found.length !== 1) {
      throw new QueryError(
        'invalid',
        `$${name} has several values; only a query parameter that is $${name} alone takes them.`,
      );
    }
    return encode(found[0] ?? '');
  });
}

/**
 * Binds the path: each variable URL-encoded, so it stays one segment.
 *
 * @param path - The path template.
 * @param values - The variables and built-ins.
 * @returns The encoded path.
 * @throws {QueryError} `invalid` for a path that is not absolute, holds `?`, `#` or `\`, or holds
 *   a `.` or `..` segment (`%2e` counts as a dot) before or after the values go in.
 */
function bindPath(path: string, values: Values): string {
  if (!pathShape.test(path) || hasDotSegment(path)) throw new QueryError('invalid', pathRule);
  const bound = substitute(path, values, encodeURIComponent);
  if (hasDotSegment(bound)) throw new QueryError('invalid', pathRule);
  return bound;
}

/**
 * Binds the query parameters, in order. A parameter that is one variable alone repeats once per
 * value; any other gets each variable's one value.
 *
 * @param query - The parameter templates.
 * @param values - The variables and built-ins.
 * @returns The parameters as name and value pairs.
 */
function bindQuery(
  query: Readonly<Record<string, string>>,
  values: Values,
): (readonly [string, string])[] {
  return Object.entries(query).flatMap(([name, template]) => {
    const alone = onlyReference.exec(template);
    if (alone)
      return valuesFor(alone[1] ?? alone[2] ?? '', values).map((value) => [name, value] as const);
    return [[name, substitute(template, values, (value) => value)] as const];
  });
}

/**
 * Binds an HTTP template.
 *
 * @param template - The method, path, parameters, body and extraction.
 * @param variables - The variable values.
 * @param timeRange - The time range, for `$__from`, `$__to` and their epoch forms.
 * @returns The bound query.
 * @throws {QueryError} `invalid` for an unknown variable, a malformed path, a variable with
 *   several values where one goes, or a body on a GET.
 */
export function bindHttp(
  template: HttpTemplate,
  variables: Variables,
  timeRange: TimeRange,
): HttpQuery {
  if (template.method === 'GET' && template.body !== undefined)
    throw new QueryError('invalid', 'A GET request has no body; use POST or query parameters.');
  const values: Values = { variables, builtIns: builtInsOf(timeRange) };
  const body = template.body === undefined ? undefined : bindJsonVariables(template.body, values);
  return {
    language: 'http',
    method: template.method,
    path: bindPath(template.path, values),
    query: bindQuery(template.query ?? {}, values),
    ...(body === undefined ? {} : { body }),
    extract: template.extract,
  };
}
