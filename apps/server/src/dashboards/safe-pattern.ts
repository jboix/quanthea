/**
 * Finds the text-variable patterns that could block the server: a pattern runs on every value a
 * viewer types, in a backtracking engine. Exponential time comes from a repeated group that holds a
 * quantifier or an alternation (`(a+)+`, `(a|aa)*`) and from back-references; polynomial time from
 * quantifiers whose spans vary (`\d*\d*\d*\d*\d*`) and alternatives, whose choices multiply. The
 * check is conservative: it refuses some patterns that would run fast, never one that could not.
 */
import { maxTextValueLength } from '@quanthea/shared';
import { delimitedGroup } from './delimited-group.ts';
import { type Token, tokenAt } from './pattern-tokens.ts';

/** What a group holds so far. */
interface GroupState {
  /** Where its body starts. */
  readonly start: number;
  /** Whether it holds a quantifier, at any depth. */
  quantified: boolean;
  /** Whether it holds an alternation, at any depth. */
  alternation: boolean;
  /** How many alternatives it has at its own level. */
  branches: number;
}

/** A group the scan has closed. */
interface ClosedGroup extends GroupState {
  /** Its body, between its opening and its `)`. */
  readonly body: string;
}

/** Where the scan is. */
interface Scan {
  /** The open groups, the whole pattern first. */
  readonly groups: GroupState[];
  /** The group the previous token closed, if any. */
  closed: ClosedGroup | undefined;
  /** The product of every quantifier's and alternation's choices so far. */
  choices: number;
}

/**
 * The most choices a pattern may multiply: those of four unbounded quantifiers on a value of the
 * longest length, which a match still runs through in milliseconds.
 */
const maxChoices = (maxTextValueLength + 1) ** 4;

/** Why a repeated group is refused. */
const exponentialProblem =
  'The pattern repeats a group that holds a quantifier or an alternation, or refers back to a group, which can take exponential time. Write it without, such as [a-z0-9-]+.';

/** Why many varying quantifiers and alternatives are refused. */
const polynomialProblem =
  'The pattern has too many quantifiers such as ?, *, + or {1,3}, and alternatives, which can take a long time. Write a simpler one.';

/**
 * A new, empty group.
 *
 * @param start - Where its body starts.
 * @returns The state.
 */
function newGroup(start: number): GroupState {
  return { start, quantified: false, alternation: false, branches: 1 };
}

/**
 * Closes the innermost group, passing what it holds to the group around it.
 *
 * @param scan - The scan.
 * @param body - The group's body.
 * @returns The closed group, or `undefined` for a stray `)`.
 */
function closeGroup(scan: Scan, body: string): ClosedGroup | undefined {
  if (scan.groups.length < 2) return undefined;
  const group = scan.groups.pop() ?? newGroup(0);
  const parent = scan.groups.at(-1) ?? newGroup(0);
  parent.quantified ||= group.quantified;
  parent.alternation ||= group.alternation;
  scan.choices *= group.branches;
  return { ...group, body };
}

/**
 * Applies a token to the scan.
 *
 * @param scan - The scan.
 * @param token - The token.
 * @param pattern - The pattern.
 * @param index - Where the token starts.
 */
function step(scan: Scan, token: Token, pattern: string, index: number): void {
  const current = scan.groups.at(-1) ?? newGroup(0);
  if (token.kind === 'open') scan.groups.push(newGroup(token.end));
  if (token.kind === 'alternation') {
    current.alternation = true;
    current.branches += 1;
  }
  if (token.kind === 'quantifier') {
    current.quantified = true;
    scan.choices *= token.choices;
  }
  scan.closed =
    token.kind === 'close' ? closeGroup(scan, pattern.slice(current.start, index)) : undefined;
}

/**
 * Whether a token makes the pattern exponential: a back-reference, or a repeating quantifier on a
 * group that holds an alternation, or a quantifier unless its iterations cannot overlap.
 *
 * @param token - The token.
 * @param closed - The group the previous token closed, if any.
 * @returns `true` when it does.
 */
function exponential(token: Token, closed: ClosedGroup | undefined): boolean {
  if (token.kind === 'backReference') return true;
  if (token.kind !== 'quantifier' || !token.repeats || !closed) return false;
  if (closed.alternation) return true;
  return closed.quantified && !delimitedGroup(closed.body);
}

/**
 * Why a pattern could take more than linear time, if it could.
 *
 * @param pattern - A pattern that compiles, without the anchors the binding adds.
 * @returns The problem, in words for the author, or `undefined` for a safe pattern.
 */
export function slowPattern(pattern: string): string | undefined {
  const scan: Scan = { groups: [newGroup(0)], closed: undefined, choices: 1 };
  for (let index = 0; index < pattern.length; ) {
    const token = tokenAt(pattern, index);
    if (exponential(token, scan.closed)) return exponentialProblem;
    step(scan, token, pattern, index);
    index = token.end;
  }
  const choices = scan.choices * (scan.groups[0]?.branches ?? 1);
  return choices > maxChoices ? polynomialProblem : undefined;
}
