/**
 * Binds variables into a Redis or Valkey template: one read command, and arguments in which `$name`
 * is a variable. Each argument goes to the server as one argument whatever it holds, so a value
 * never becomes a command; an argument that is a multi-value variable alone becomes one argument
 * per value.
 */
import { type RedisQuery, redisReadCommands, type TimeRange } from '../connectors/_shared/index.ts';
import { QueryError } from './query-error.ts';
import { type Variables, valuesOf } from './variables.ts';

/** The Redis template of a panel query. */
export interface RedisTemplate {
  /** The command, such as `ZREVRANGE`. */
  readonly command: string;
  /** Its arguments, with `$name` variables. */
  readonly args?: readonly string[] | undefined;
}

/** A `$name` or `${name}` reference. */
const reference = /\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g;

/** An argument that is one reference and nothing else. */
const onlyReference = /^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))$/;

/**
 * The built-in values: the time range in epoch milliseconds and seconds, and as ISO times.
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

/**
 * The values of a reference.
 *
 * @param name - The variable name.
 * @param variables - The variables.
 * @param builtIns - The built-in values.
 * @returns Its values.
 * @throws {QueryError} `invalid` for an unknown variable.
 */
function valuesFor(
  name: string,
  variables: Variables,
  builtIns: Readonly<Record<string, string>>,
): readonly string[] {
  const builtIn = builtIns[name];
  if (builtIn !== undefined) return [builtIn];
  const binding = variables[name];
  if (!binding) throw new QueryError('invalid', `Unknown variable $${name}.`);
  return valuesOf(binding);
}

/**
 * Binds one argument: several for a multi-value variable alone.
 *
 * @param argument - The argument.
 * @param variables - The variables.
 * @param builtIns - The built-in values.
 * @returns The arguments it becomes.
 * @throws {QueryError} `invalid` for an unknown variable, or one with several values inside text.
 */
function bindArgument(
  argument: string,
  variables: Variables,
  builtIns: Readonly<Record<string, string>>,
): readonly string[] {
  const alone = onlyReference.exec(argument);
  if (alone) return valuesFor(alone[1] ?? alone[2] ?? '', variables, builtIns);
  return [
    argument.replace(reference, (_match, braced?: string, bare?: string) => {
      const name = braced ?? bare ?? '';
      const values = valuesFor(name, variables, builtIns);
      if (values.length !== 1)
        throw new QueryError(
          'invalid',
          `$${name} has several values; give it an argument of its own.`,
        );
      return values[0] ?? '';
    }),
  ];
}

/**
 * Binds a Redis template.
 *
 * @param template - The command and its arguments.
 * @param variables - The variable values.
 * @param timeRange - The time range, for `$__from_ms` and the other built-ins.
 * @returns The bound query.
 * @throws {QueryError} `invalid` for a command a query may not run, or an unknown variable.
 */
export function bindRedis(
  template: RedisTemplate,
  variables: Variables,
  timeRange: TimeRange,
): RedisQuery {
  const command = template.command.toUpperCase();
  if (!redisReadCommands.has(command)) {
    throw new QueryError(
      'invalid',
      `A query runs read commands only, such as GET, HGETALL, ZREVRANGE or XRANGE; ${command} is not one.`,
    );
  }
  const builtIns = builtInsOf(timeRange);
  const args = (template.args ?? []).flatMap((argument) =>
    bindArgument(argument, variables, builtIns),
  );
  return { language: 'redis', command, args };
}
