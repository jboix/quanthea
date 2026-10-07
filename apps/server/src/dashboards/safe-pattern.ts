/**
 * Finds the text-variable patterns that could block the server: a pattern runs on every value a
 * viewer types, in a backtracking engine. Exponential time comes from a repeated group that holds a
 * quantifier or an alternation (`(a+)+`, `(a|aa)*`) and from back-references; polynomial time from
 * many quantifiers whose spans vary (`\d*\d*\d*\d*\d*`). The check is conservative: it refuses some
 * patterns that would run fast, never one that could not.
 */

/** A token of a pattern, as far as backtracking goes. */
type Token =
  | {
      readonly kind: 'open' | 'close' | 'alternation' | 'atom' | 'backReference';
      readonly end: number;
    }
  | {
      readonly kind: 'quantifier';
      readonly end: number;
      /** Whether it may match more than once, such as `+` or `{2}`. */
      readonly repeats: boolean;
      /** Whether its span varies, such as `?`, `*` or `{1,3}`. */
      readonly varies: boolean;
    };

/** What a group holds so far. */
interface GroupState {
  /** Whether it holds a quantifier, at any depth. */
  quantified: boolean;
  /** Whether it holds an alternation, at any depth. */
  alternation: boolean;
}

/** The most quantifiers whose spans vary, so a match of at most 100 characters stays fast. */
const maxVaryingQuantifiers = 4;

/** How many times a quantifier matches, at least and at most. */
interface Span {
  /** The least. */
  readonly least: number;
  /** The most, `Infinity` when unbounded. */
  readonly most: number;
}

/** The spans of `*`, `+` and `?`. */
const symbolSpans: ReadonlyMap<string, Span> = new Map([
  ['*', { least: 0, most: Number.POSITIVE_INFINITY }],
  ['+', { least: 1, most: Number.POSITIVE_INFINITY }],
  ['?', { least: 0, most: 1 }],
]);

/** A counted quantifier: `{n}`, `{n,}` or `{n,m}`. */
const counted = /^\{(\d+)(,(\d*))?\}/;

/** A named group's opening, `(?<name>`. */
const namedGroup = /^\(\?<[A-Za-z_$][\w$]*>/;

/** Why a repeated group is refused. */
const exponentialProblem =
  'The pattern repeats a group that holds a quantifier or an alternation, or refers back to a group, which can take exponential time. Write it without, such as [a-z0-9-]+.';

/** Why many varying quantifiers are refused. */
const polynomialProblem = `The pattern has more than ${maxVaryingQuantifiers} quantifiers such as ?, *, + or {1,3}, which can take a long time. Write a simpler one.`;

/**
 * A new, empty group.
 *
 * @returns The state.
 */
function newGroup(): GroupState {
  return { quantified: false, alternation: false };
}

/**
 * The token of an escape: a back-reference (`\1`, `\k<name>`) or one character.
 *
 * @param pattern - The pattern.
 * @param index - Where the backslash is.
 * @returns The token.
 */
function escapeAt(pattern: string, index: number): Token {
  const next = pattern[index + 1] ?? '';
  const kind = /[1-9k]/.test(next) ? 'backReference' : 'atom';
  return { kind, end: index + 2 };
}

/**
 * Where a character class ends.
 *
 * @param pattern - The pattern.
 * @param index - Where the `[` is.
 * @returns The index after its `]`.
 */
function classEnd(pattern: string, index: number): number {
  let at = index + 1;
  while (at < pattern.length && pattern[at] !== ']') at += pattern[at] === '\\' ? 2 : 1;
  return at + 1;
}

/**
 * Where a group's opening ends: after `(`, `(?:`, `(?=`, `(?!`, `(?<=`, `(?<!` or `(?<name>`.
 *
 * @param pattern - The pattern.
 * @param index - Where the `(` is.
 * @returns The index after the opening.
 */
function openingEnd(pattern: string, index: number): number {
  if (pattern[index + 1] !== '?') return index + 1;
  const named = namedGroup.exec(pattern.slice(index));
  if (named) return index + named[0].length;
  return index + (pattern[index + 2] === '<' ? 4 : 3);
}

/**
 * The span of a counted quantifier.
 *
 * @param count - The match of {@link counted}.
 * @returns The least and most times it matches.
 */
function countedSpan(count: RegExpExecArray): Span {
  const least = Number(count[1]);
  if (count[2] === undefined) return { least, most: least };
  return { least, most: count[3] ? Number(count[3]) : Number.POSITIVE_INFINITY };
}

/**
 * The quantifier at an index, with its lazy `?` if any.
 *
 * @param pattern - The pattern.
 * @param index - The index.
 * @returns The token, or `undefined` when there is none.
 */
function quantifierAt(pattern: string, index: number): Token | undefined {
  const count = counted.exec(pattern.slice(index));
  const span = count ? countedSpan(count) : symbolSpans.get(pattern[index] ?? '');
  if (!span) return undefined;
  const end = index + (count?.[0].length ?? 1);
  return {
    kind: 'quantifier',
    end: pattern[end] === '?' ? end + 1 : end,
    repeats: span.most > 1,
    varies: span.most > span.least,
  };
}

/**
 * The token at an index.
 *
 * @param pattern - The pattern.
 * @param index - The index.
 * @returns The token.
 */
function tokenAt(pattern: string, index: number): Token {
  const char = pattern[index];
  if (char === '\\') return escapeAt(pattern, index);
  if (char === '[') return { kind: 'atom', end: classEnd(pattern, index) };
  if (char === '(') return { kind: 'open', end: openingEnd(pattern, index) };
  if (char === ')') return { kind: 'close', end: index + 1 };
  if (char === '|') return { kind: 'alternation', end: index + 1 };
  return quantifierAt(pattern, index) ?? { kind: 'atom', end: index + 1 };
}

/**
 * Closes the innermost group, passing what it holds to the group around it.
 *
 * @param groups - The open groups, the whole pattern first.
 * @returns The closed group, or `undefined` for a stray `)`.
 */
function closeGroup(groups: GroupState[]): GroupState | undefined {
  if (groups.length < 2) return undefined;
  const group = groups.pop() ?? newGroup();
  const parent = groups.at(-1) ?? newGroup();
  parent.quantified ||= group.quantified;
  parent.alternation ||= group.alternation;
  return group;
}

/**
 * Applies a token to the open groups.
 *
 * @param groups - The open groups, the whole pattern first.
 * @param token - The token.
 * @returns The group the token closed, if it closed one.
 */
function step(groups: GroupState[], token: Token): GroupState | undefined {
  const current = groups.at(-1) ?? newGroup();
  if (token.kind === 'open') groups.push(newGroup());
  if (token.kind === 'alternation') current.alternation = true;
  if (token.kind === 'quantifier') current.quantified = true;
  return token.kind === 'close' ? closeGroup(groups) : undefined;
}

/**
 * Whether a token makes the pattern exponential: a back-reference, or a repeating quantifier on a
 * group that holds a quantifier or an alternation.
 *
 * @param token - The token.
 * @param closed - The group the previous token closed, if any.
 * @returns `true` when it does.
 */
function exponential(token: Token, closed: GroupState | undefined): boolean {
  if (token.kind === 'backReference') return true;
  if (token.kind !== 'quantifier' || !token.repeats || !closed) return false;
  return closed.quantified || closed.alternation;
}

/**
 * Why a pattern could take more than linear time, if it could.
 *
 * @param pattern - A pattern that compiles, without the anchors the binding adds.
 * @returns The problem, in words for the author, or `undefined` for a safe pattern.
 */
export function slowPattern(pattern: string): string | undefined {
  const groups = [newGroup()];
  let closed: GroupState | undefined;
  let varying = 0;
  for (let index = 0; index < pattern.length; ) {
    const token = tokenAt(pattern, index);
    if (exponential(token, closed)) return exponentialProblem;
    if (token.kind === 'quantifier' && token.varies) varying += 1;
    closed = step(groups, token);
    index = token.end;
  }
  return varying > maxVaryingQuantifiers ? polynomialProblem : undefined;
}
