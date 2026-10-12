/**
 * The state of a scan over a SQL statement's tokens, and the small questions it asks of them: the
 * open levels of parentheses, what a token is, and where a dotted name or a list ends.
 */
import type { SqlToken } from './sql-tokens.ts';

/** What a statement reads, as far as its text says. */
export interface SqlReads {
  /** The tables named, each as its parts: `schema`, `table`. */
  readonly tables: string[][];
  /** The functions called where a table goes, each as its parts. */
  readonly tableFunctions: string[][];
  /** Every function called, in lower case. */
  readonly calls: Set<string>;
}

/** One level of parentheses. */
interface Level {
  /** Whether a SELECT was seen at this level, so a FROM opens a clause here. */
  select: boolean;
  /** Whether a comma at this level separates tables. */
  from: boolean;
  /** Whether a WITH list is open at this level. */
  withList: boolean;
  /** The names the WITH clauses of this level define, in lower case. */
  readonly defined: Set<string>;
}

/** The scan of one statement. */
export interface Scan {
  /** The tokens. */
  readonly tokens: readonly SqlToken[];
  /** The open levels, outermost first. */
  readonly levels: Level[];
  /** Whether the next token starts a table. */
  expectTable: boolean;
  /** What was found. */
  readonly reads: SqlReads;
}

/**
 * A new level.
 *
 * @returns The level, with nothing seen.
 */
export function newLevel(): Level {
  return { select: false, from: false, withList: false, defined: new Set() };
}

/**
 * The innermost open level.
 *
 * @param scan - The scan.
 * @returns The level.
 */
export function current(scan: Scan): Level {
  const level = scan.levels.at(-1);
  if (level) return level;
  const root = newLevel();
  scan.levels.push(root);
  return root;
}

/**
 * Whether a token is the given mark.
 *
 * @param token - The token.
 * @param text - The mark.
 * @returns `true` when it is.
 */
export function isMark(token: SqlToken | undefined, text: string): boolean {
  return token?.kind === 'mark' && token.text === text;
}

/**
 * Whether a token is the given keyword.
 *
 * @param token - The token.
 * @param text - The keyword, in lower case.
 * @returns `true` when it is.
 */
export function isWord(token: SqlToken | undefined, text: string): boolean {
  return token?.kind === 'word' && token.text === text;
}

/**
 * Whether a token can name something.
 *
 * @param token - The token.
 * @returns `true` for a bare or quoted identifier.
 */
export function isName(token: SqlToken | undefined): token is SqlToken {
  return token?.kind === 'word' || token?.kind === 'name';
}

/**
 * Reads a dotted name.
 *
 * @param tokens - The tokens.
 * @param start - The index of its first part.
 * @returns The parts and the index after them.
 */
export function dottedName(
  tokens: readonly SqlToken[],
  start: number,
): { parts: string[]; end: number } {
  const parts = [tokens[start]?.text ?? ''];
  let end = start + 1;
  while (isMark(tokens[end], '.') && isName(tokens[end + 1])) {
    parts.push(tokens[end + 1]?.text ?? '');
    end += 2;
  }
  return { parts, end };
}

/**
 * The index after a parenthesised list that opens at an index.
 *
 * @param tokens - The tokens.
 * @param open - The index of the opening parenthesis.
 * @returns The index after its closing parenthesis.
 */
export function afterParentheses(tokens: readonly SqlToken[], open: number): number {
  let depth = 0;
  for (let index = open; index < tokens.length; index += 1) {
    if (isMark(tokens[index], '(')) depth += 1;
    if (isMark(tokens[index], ')')) depth -= 1;
    if (depth === 0) return index + 1;
  }
  return tokens.length;
}
