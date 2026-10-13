/**
 * Binds variables into a PromQL template. A `$name` is replaced only inside the string value of a
 * label matcher (`env="$env"`), escaped for that string, and for `=~` and `!~` escaped as a regular
 * expression too. Anywhere else a variable is an error, except the built-in durations.
 */
import type { PromqlQuery } from '../connectors/_shared/index.ts';
import { type ExpressionRun, intervalValue, stepOf } from './promql-step.ts';
import { QueryError } from './query-error.ts';
import { type Variables, valuesOf } from './variables.ts';

/** A run of PromQL text. */
export interface PromqlSegment {
  /** `code`, a `string` literal (with its quotes), or a `comment`. */
  readonly kind: 'code' | 'string' | 'comment';
  /** The text. */
  readonly text: string;
}

/** The PromQL template of a panel query. */
export interface PromqlTemplate {
  /** The expression. */
  readonly expr: string;
  /** Evaluate once at the end of the time range instead of over it. */
  readonly instant?: boolean | undefined;
  /** The smallest step between points, such as `15s` or `1m`. */
  readonly step?: string | undefined;
}

/** Where a string literal or a comment may start. */
const literalStart = /["'`#]/g;

/** The whole of each kind of literal, by its first character. */
const literalPatterns: Readonly<Record<string, RegExp>> = {
  '"': /"(?:[^"\\]|\\[\s\S])*"/y,
  "'": /'(?:[^'\\]|\\[\s\S])*'/y,
  '`': /`[^`]*`/y,
  '#': /#[^\n]*/y,
};

/** A `$name` or `${name}` reference. */
const reference = /\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g;

/** Regular expression metacharacters of RE2, escaped in `=~` and `!~` values. */
const regexMetacharacters = /[\\.+*?()|[\]{}^$]/g;

/** The matcher operator that ends a run of code, if any. */
const trailingOperator = /(=~|!~|!=|=)\s*$/;

/** The message for a variable where it may not be. */
const misplacedVariable =
  'Variables go in label matcher values, such as env="$env". Only an interval variable goes where a duration does, such as [$interval].';

/**
 * Splits PromQL into code, string literals and comments.
 *
 * @param text - The PromQL.
 * @returns The segments, in order.
 * @throws {QueryError} `invalid` when a string is not closed.
 */
export function splitPromql(text: string): PromqlSegment[] {
  const segments: PromqlSegment[] = [];
  const starts = new RegExp(literalStart.source, 'g');
  let codeStart = 0;
  for (let match = starts.exec(text); match; match = starts.exec(text)) {
    const pattern = literalPatterns[match[0]] as RegExp;
    pattern.lastIndex = match.index;
    const literal = pattern.exec(text)?.[0];
    if (literal === undefined)
      throw new QueryError('invalid', 'The query has an unterminated string.');
    if (match.index > codeStart)
      segments.push({ kind: 'code', text: text.slice(codeStart, match.index) });
    segments.push({ kind: match[0] === '#' ? 'comment' : 'string', text: literal });
    codeStart = match.index + literal.length;
    starts.lastIndex = codeStart;
  }
  if (text.length > codeStart) segments.push({ kind: 'code', text: text.slice(codeStart) });
  return segments;
}

/**
 * Escapes a value for the inside of a PromQL string literal.
 *
 * @param value - The value.
 * @param quote - The literal's quote character.
 * @returns The escaped value.
 */
function escapeForString(value: string, quote: string): string {
  const escaped = JSON.stringify(value).slice(1, -1);
  return quote === '"' ? escaped : escaped.replaceAll('\\"', '"').replaceAll("'", "\\'");
}

/**
 * The text a variable becomes inside a matcher value.
 *
 * @param name - The variable name.
 * @param operator - The matcher operator: `=`, `!=`, `=~` or `!~`.
 * @param variables - The variables.
 * @returns The value, not yet escaped for the string.
 * @throws {QueryError} `invalid` for an unknown variable, or several values in an exact matcher.
 */
function matcherValue(name: string, operator: string, variables: Variables): string {
  const binding = variables[name];
  if (!binding) throw new QueryError('invalid', `Unknown variable $${name}.`);
  const values = valuesOf(binding);
  if (operator.endsWith('~')) {
    return values.map((value) => value.replace(regexMetacharacters, '\\$&')).join('|');
  }
  if (values.length !== 1) {
    throw new QueryError(
      'invalid',
      `$${name} has several values; match it with =~ instead of ${operator}.`,
    );
  }
  return values[0] ?? '';
}

/**
 * Binds the variables of one string literal, when it is a matcher value.
 *
 * @param literal - The string literal, with its quotes.
 * @param operator - The matcher operator before it, or `undefined` when it is not a matcher value.
 * @param variables - The variables.
 * @param misplaced - Why a variable elsewhere is refused.
 * @returns The literal with the variables substituted.
 * @throws {QueryError} `invalid` for a variable outside a matcher value or in a raw string.
 */
function bindString(
  literal: string,
  operator: string | undefined,
  variables: Variables,
  misplaced: string,
): string {
  if (!literal.includes('$')) return literal;
  const quote = literal[0] ?? '"';
  if (operator === undefined || quote === '`') throw new QueryError('invalid', misplaced);
  return literal.replace(reference, (_match, braced?: string, bare?: string) =>
    escapeForString(matcherValue(braced ?? bare ?? '', operator, variables), quote),
  );
}

/**
 * Binds the durations in a run of code: the built-in ones and interval variables. Any other
 * variable in code is an error.
 *
 * @param code - The code.
 * @param durations - The built-in durations, such as `__interval` → `60s`.
 * @param variables - The variables, for interval variables.
 * @param misplaced - Why any other variable is refused.
 * @returns The code with the durations substituted.
 * @throws {QueryError} `invalid` for any other variable.
 */
function bindCode(
  code: string,
  durations: Readonly<Record<string, string>>,
  variables: Variables,
  misplaced: string,
): string {
  return code.replace(reference, (_match, braced?: string, bare?: string) => {
    const name = braced ?? bare ?? '';
    const duration = durations[name] ?? intervalValue(name, variables);
    if (duration === undefined) throw new QueryError('invalid', misplaced);
    return duration;
  });
}

/**
 * Where a language takes variables: PromQL in label matchers, LogQL also in line and label
 * filters.
 */
export interface ExpressionFlavor {
  /**
   * The operator a string follows, when the string is a value that takes variables.
   *
   * @param state - What binding has seen so far.
   * @returns The operator, or `undefined` when the string takes no variable.
   */
  operatorOf(state: BindingState): string | undefined;
  /** Why a variable elsewhere is refused. */
  readonly misplaced: string;
  /** Checks the code of the whole expression, such as for refused keywords. */
  readonly checkCode?: (code: string) => void;
}

/** What binding has seen so far: how deep in braces, and the code just before a string. */
export interface BindingState {
  /** The number of open `{`. */
  braceDepth: number;
  /** The last run of code. */
  previousCode: string;
}

/**
 * The change in brace depth over a run of code.
 *
 * @param code - The code.
 * @returns Opening braces minus closing ones.
 */
function braceDelta(code: string): number {
  return (code.match(/\{/g)?.length ?? 0) - (code.match(/\}/g)?.length ?? 0);
}

/**
 * The matcher operator a string follows, when the string is a matcher value.
 *
 * @param state - The binding state.
 * @returns The operator, or `undefined` outside braces or after anything else.
 */
function matcherOperator(state: BindingState): string | undefined {
  return state.braceDepth > 0 ? trailingOperator.exec(state.previousCode)?.[1] : undefined;
}

/** PromQL: variables go in label matcher values. */
const promqlFlavor: ExpressionFlavor = {
  operatorOf: matcherOperator,
  misplaced: misplacedVariable,
};

/**
 * Binds one segment and updates the state.
 *
 * @param segment - The segment.
 * @param state - The binding state.
 * @param variables - The variables.
 * @param durations - The built-in durations.
 * @param flavor - Where the language takes variables.
 * @returns The bound text.
 */
function bindSegment(
  segment: PromqlSegment,
  state: BindingState,
  variables: Variables,
  durations: Readonly<Record<string, string>>,
  flavor: ExpressionFlavor,
): string {
  if (segment.kind === 'comment') return segment.text;
  if (segment.kind === 'string')
    return bindString(segment.text, flavor.operatorOf(state), variables, flavor.misplaced);
  state.braceDepth += braceDelta(segment.text);
  state.previousCode = segment.text;
  return bindCode(segment.text, durations, variables, flavor.misplaced);
}

/**
 * The code of an expression, without its strings and comments.
 *
 * @param segments - The expression's segments.
 * @returns The code segments, joined by a space.
 */
function codeOf(segments: readonly PromqlSegment[]): string {
  return segments
    .filter((segment) => segment.kind === 'code')
    .map((segment) => segment.text)
    .join(' ');
}

/**
 * Binds every segment, following the brace depth to know which strings are matcher values.
 *
 * @param segments - The expression's segments.
 * @param variables - The variables.
 * @param durations - The built-in durations.
 * @param flavor - Where the language takes variables.
 * @returns The bound expression.
 */
function bindSegments(
  segments: readonly PromqlSegment[],
  variables: Variables,
  durations: Readonly<Record<string, string>>,
  flavor: ExpressionFlavor,
): string {
  flavor.checkCode?.(codeOf(segments));
  const state: BindingState = { braceDepth: 0, previousCode: '' };
  return segments
    .map((segment) => bindSegment(segment, state, variables, durations, flavor))
    .join('');
}

/** An expression bound for its language, with the step of a range query. */
interface BoundExpression {
  /** The expression. */
  readonly expr: string;
  /** Whether it evaluates once at the end of the range. */
  readonly instant: boolean;
  /** Seconds between points. */
  readonly stepSeconds: number;
}

/**
 * Binds an expression in a Prometheus-like language: its variables, its built-in durations and
 * its step.
 *
 * @param template - The expression, and whether it is instant and its step.
 * @param variables - The variable values.
 * @param run - The time range, the point limit and the chosen interval.
 * @param flavor - Where the language takes variables.
 * @returns The bound expression.
 * @throws {QueryError} `invalid` for an unknown variable, a variable where the language takes
 *   none, or an unclosed string.
 */
export function bindExpression(
  template: PromqlTemplate,
  variables: Variables,
  run: ExpressionRun,
  flavor: ExpressionFlavor,
): BoundExpression {
  const { timeRange } = run;
  const segments = splitPromql(template.expr);
  const stepSeconds = stepOf(template, variables, run, codeOf(segments));
  const rangeSeconds = Math.max(
    1,
    Math.round((timeRange.to.getTime() - timeRange.from.getTime()) / 1000),
  );
  const durations = {
    __interval: `${stepSeconds}s`,
    __range: `${rangeSeconds}s`,
    __rate_interval: `${Math.max(4 * stepSeconds, 60)}s`,
  };
  const expr = bindSegments(segments, variables, durations, flavor);
  return { expr, instant: template.instant ?? false, stepSeconds };
}

/**
 * Binds a PromQL template.
 *
 * @param template - The expression, and whether it is instant and its step.
 * @param variables - The variable values.
 * @param run - The time range, the point limit, the chosen interval and the chart's points.
 * @returns The bound query.
 * @throws {QueryError} `invalid` for an unknown variable, a variable outside a matcher value, or an
 *   unclosed string.
 */
export function bindPromql(
  template: PromqlTemplate,
  variables: Variables,
  run: ExpressionRun,
): PromqlQuery {
  return { language: 'promql', ...bindExpression(template, variables, run, promqlFlavor) };
}
