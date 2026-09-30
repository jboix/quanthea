/**
 * How Trino writes its literals, the SQL standard's: strings in single quotes and identifiers in
 * double quotes, each escaping its quote by doubling it and nothing else, `--` line comments and
 * block comments that do not nest.
 */
import { lineCommentEnd, type SqlLexicon, stickyEnd, unterminated } from './sql-lexer.ts';

/** Where a literal may start. `--` always opens a comment: `1--1` is `1`. */
const literalStart = /'|"|--|\/\*/g;

/** A string, where only a doubled quote escapes: a backslash is a plain character. */
const singleQuoted = /'(?:[^']|'')*'/y;

/** An identifier in double quotes, where a doubled quote escapes. */
const doubleQuoted = /"(?:[^"]|"")*"/y;

/**
 * The end of a block comment, which does not nest.
 *
 * @param text - The SQL.
 * @param start - Where the comment starts.
 * @returns The index just past the comment.
 * @throws {QueryError} When the comment is not closed.
 */
function blockCommentEnd(text: string, start: number): number {
  const close = text.indexOf('*/', start + 2);
  if (close === -1) throw unterminated();
  return close + 2;
}

/** The end of each kind of literal, by how it opens. */
const literalEnds: Readonly<Record<string, (text: string, start: number) => number>> = {
  "'": (text, start) => stickyEnd(singleQuoted, text, start),
  '"': (text, start) => stickyEnd(doubleQuoted, text, start),
  '--': lineCommentEnd,
  '/*': blockCommentEnd,
};

/**
 * The end of the literal that opens at an index.
 *
 * @param text - The SQL.
 * @param start - Where the opener was found.
 * @param opener - What was found: a quote or a comment start.
 * @returns The index just past the literal.
 */
function literalEnd(text: string, start: number, opener: string): number | undefined {
  return literalEnds[opener]?.(text, start);
}

/** The Trino lexicon. */
export const trinoLexicon: SqlLexicon = { literalStart, literalEnd };
