/**
 * How MySQL and MariaDB write their literals: strings in single or double quotes with backslash
 * escapes, identifiers in backticks, `#` and `-- ` line comments, and block comments. A comment
 * that opens with `/*!` or `/*M!` runs its content as code, so it is refused.
 */
import { QueryError } from './query-error.ts';
import { lineCommentEnd, type SqlLexicon, stickyEnd, unterminated } from './sql-lexer.ts';

/**
 * Where a literal may start. `--` opens a comment only before whitespace or the end: `1--1` is
 * arithmetic.
 */
const literalStart = /'|"|`|#|--(?=\s|$)|\/\*/g;

/** A string in single quotes, where a backslash or a doubled quote escapes. */
const singleQuoted = /'(?:[^'\\]|\\[\s\S]|'')*'/y;

/** A string in double quotes, where a backslash or a doubled quote escapes. */
const doubleQuoted = /"(?:[^"\\]|\\[\s\S]|"")*"/y;

/** An identifier in backticks, where a doubled backtick escapes. */
const backticked = /`(?:[^`]|``)*`/y;

/** The opening of an executable comment, whose content the server runs. */
const executableComment = /\/\*M?!/y;

/**
 * The end of a block comment, which does not nest. An executable comment is refused.
 *
 * @param text - The SQL.
 * @param start - Where the comment starts.
 * @returns The index just past the comment.
 * @throws {QueryError} `invalid` for an executable comment or one that is not closed.
 */
function blockCommentEnd(text: string, start: number): number {
  executableComment.lastIndex = start;
  if (executableComment.test(text)) {
    throw new QueryError('invalid', 'Executable comments such as /*! … */ are not allowed.');
  }
  const close = text.indexOf('*/', start + 2);
  if (close === -1) throw unterminated();
  return close + 2;
}

/** The end of each kind of literal, by how it opens. */
const literalEnds: Readonly<Record<string, (text: string, start: number) => number>> = {
  "'": (text, start) => stickyEnd(singleQuoted, text, start),
  '"': (text, start) => stickyEnd(doubleQuoted, text, start),
  '`': (text, start) => stickyEnd(backticked, text, start),
  '#': lineCommentEnd,
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

/** The MySQL and MariaDB lexicon. */
export const mysqlLexicon: SqlLexicon = { literalStart, literalEnd };
