/**
 * Splits SQL into code, which the binder may rewrite, and literals (strings, quoted identifiers,
 * comments), which it must leave alone. Each dialect says where its literals start and end.
 */
import { QueryError } from './query-error.ts';

/** A run of SQL text. */
export interface SqlSegment {
  /** `code` may hold variables and keywords; `literal` is copied as is. */
  readonly kind: 'code' | 'literal';
  /** The text. */
  readonly text: string;
}

/** How one dialect writes its literals. */
export interface SqlLexicon {
  /** Where a literal may start, as a global pattern. */
  readonly literalStart: RegExp;
  /**
   * The end of the literal that opens at an index.
   *
   * @param text - The SQL.
   * @param start - Where the opener was found.
   * @param opener - What {@link SqlLexicon.literalStart} matched.
   * @returns The index just past the literal, or `undefined` when the opener starts no literal.
   * @throws {QueryError} `invalid` when the literal is not closed or not allowed.
   */
  literalEnd(text: string, start: number, opener: string): number | undefined;
}

/**
 * The error for a literal that is not closed.
 *
 * @returns The error.
 */
export function unterminated(): QueryError {
  return new QueryError('invalid', 'The query has an unterminated string, identifier or comment.');
}

/**
 * The end of a sticky pattern matched at an index.
 *
 * @param pattern - A sticky pattern.
 * @param text - The SQL.
 * @param start - Where the literal starts.
 * @returns The index just past the match.
 * @throws {QueryError} When the pattern does not match: the literal is not closed.
 */
export function stickyEnd(pattern: RegExp, text: string, start: number): number {
  pattern.lastIndex = start;
  const match = pattern.exec(text);
  if (!match) throw unterminated();
  return start + match[0].length;
}

/**
 * The end of a line comment: the next newline, which stays code.
 *
 * @param text - The SQL.
 * @param start - Where the comment starts.
 * @returns The index of the newline, or the end of the text.
 */
export function lineCommentEnd(text: string, start: number): number {
  const newline = text.indexOf('\n', start);
  return newline === -1 ? text.length : newline;
}

/** Characters that can continue an identifier, so a `$` after them opens no dollar quote. */
export const identifierCharacter = /[A-Za-z0-9_$]/;

/**
 * The end of a block comment that may nest, as in PostgreSQL and ClickHouse.
 *
 * @param text - The SQL.
 * @param start - Where the comment starts.
 * @returns The index just past the comment.
 * @throws {QueryError} When the comment is not closed.
 */
export function nestedCommentEnd(text: string, start: number): number {
  const marker = /\/\*|\*\//g;
  marker.lastIndex = start;
  let depth = 0;
  for (let match = marker.exec(text); match; match = marker.exec(text)) {
    depth += match[0] === '/*' ? 1 : -1;
    if (depth === 0) return marker.lastIndex;
  }
  throw unterminated();
}

/**
 * The end of a dollar-quoted string (`$$…$$`, `$tag$…$tag$`), which runs to the same tag. A tag
 * right after an identifier character is part of the identifier.
 *
 * @param text - The SQL.
 * @param start - Where the tag starts.
 * @param tag - The opening tag.
 * @returns The index just past the string, or `undefined` when the tag opens no string.
 * @throws {QueryError} When the string is not closed.
 */
export function dollarQuoteEnd(text: string, start: number, tag: string): number | undefined {
  if (identifierCharacter.test(text[start - 1] ?? '')) return undefined;
  const close = text.indexOf(tag, start + tag.length);
  if (close === -1) throw unterminated();
  return close + tag.length;
}

/**
 * Splits SQL into code and literals.
 *
 * @param text - The SQL.
 * @param lexicon - How the dialect writes its literals.
 * @returns The segments, in order; joined, they are the input.
 * @throws {QueryError} `invalid` when a string, identifier or comment is not closed.
 */
export function splitSql(text: string, lexicon: SqlLexicon): SqlSegment[] {
  const segments: SqlSegment[] = [];
  const starts = new RegExp(lexicon.literalStart.source, 'g');
  let codeStart = 0;
  for (let match = starts.exec(text); match; match = starts.exec(text)) {
    const end = lexicon.literalEnd(text, match.index, match[0]);
    if (end === undefined) continue;
    if (match.index > codeStart)
      segments.push({ kind: 'code', text: text.slice(codeStart, match.index) });
    segments.push({ kind: 'literal', text: text.slice(match.index, end) });
    codeStart = end;
    starts.lastIndex = end;
  }
  if (text.length > codeStart) segments.push({ kind: 'code', text: text.slice(codeStart) });
  return segments;
}
