/**
 * Reads SQL as a flat list of words, names and marks, over the dialect's own lexer: comments are
 * dropped, strings are opaque, and a quoted identifier is a name with its quotes removed.
 */
import type { SqlFlavor } from '../sql-dialects.ts';
import { rulesOf } from '../sql-dialects.ts';
import { type SqlSegment, splitSql } from '../sql-lexer.ts';

/** One token of a statement. */
export interface SqlToken {
  /**
   * `word` for a bare identifier or keyword, `name` for a quoted identifier, `mark` for
   * punctuation, `value` for a string or a number.
   */
  readonly kind: 'word' | 'name' | 'mark' | 'value';
  /** The text: a word in lower case, a name without its quotes. */
  readonly text: string;
}

/** A bare identifier, a number, or one mark. */
const codeToken = /([\p{L}_][\p{L}\p{N}_$]*)|(\d[\p{L}\p{N}_.]*)|\S/gu;

/** How a comment starts, in any dialect. */
const commentStart = /^(?:--|\/\*|#)/;

/**
 * The tokens of a run of code.
 *
 * @param code - The code.
 * @returns Its words, numbers and marks.
 */
function codeTokens(code: string): SqlToken[] {
  return [...code.matchAll(codeToken)].map((match): SqlToken => {
    if (match[1] !== undefined) return { kind: 'word', text: match[1].toLowerCase() };
    return { kind: match[2] === undefined ? 'mark' : 'value', text: match[0] };
  });
}

/**
 * The token of a literal: a quoted identifier is a name, a comment is nothing, the rest a value.
 *
 * @param literal - The literal, with its quotes.
 * @returns The token, or none for a comment.
 */
function literalTokens(literal: string): SqlToken[] {
  if (commentStart.test(literal)) return [];
  const quote = literal[0] ?? '';
  if (quote !== '"' && quote !== '`') return [{ kind: 'value', text: '' }];
  const inner = literal.slice(1, -1).replaceAll(quote + quote, quote);
  return [{ kind: 'name', text: inner }];
}

/**
 * The tokens of a segment.
 *
 * @param segment - A run of code or a literal.
 * @returns Its tokens.
 */
function segmentTokens(segment: SqlSegment): SqlToken[] {
  return segment.kind === 'code' ? codeTokens(segment.text) : literalTokens(segment.text);
}

/**
 * The tokens of a statement.
 *
 * @param text - The SQL.
 * @param flavor - The dialect, which says where literals start and end.
 * @returns The tokens, in order.
 * @throws {QueryError} `invalid` when a string, identifier or comment is not closed.
 */
export function sqlTokens(text: string, flavor: SqlFlavor): SqlToken[] {
  return splitSql(text, rulesOf(flavor).lexicon).flatMap(segmentTokens);
}
