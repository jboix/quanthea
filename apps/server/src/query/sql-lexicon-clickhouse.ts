/**
 * How ClickHouse writes its literals: strings in single quotes and heredocs (`$$…$$`,
 * `$tag$…$tag$`), identifiers in double quotes or backticks, all three quotes with backslash
 * escapes, `--` and `#` line comments, and block comments that nest.
 */
import {
  dollarQuoteEnd,
  lineCommentEnd,
  nestedCommentEnd,
  type SqlLexicon,
  stickyEnd,
} from './sql-lexer.ts';

/** Where a literal may start. Unlike MySQL, `--` always opens a comment: `1--1` is `1`. */
const literalStart = /'|"|`|#|--|\/\*|\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/g;

/** A string, where a backslash or a doubled quote escapes. */
const singleQuoted = /'(?:[^'\\]|\\[\s\S]|'')*'/y;

/** An identifier in double quotes, where a backslash or a doubled quote escapes. */
const doubleQuoted = /"(?:[^"\\]|\\[\s\S]|"")*"/y;

/** An identifier in backticks, where a backslash or a doubled backtick escapes. */
const backticked = /`(?:[^`\\]|\\[\s\S]|``)*`/y;

/** The end of each kind of literal, by how it opens. */
const literalEnds: Readonly<Record<string, (text: string, start: number) => number>> = {
  "'": (text, start) => stickyEnd(singleQuoted, text, start),
  '"': (text, start) => stickyEnd(doubleQuoted, text, start),
  '`': (text, start) => stickyEnd(backticked, text, start),
  '#': lineCommentEnd,
  '--': lineCommentEnd,
  '/*': nestedCommentEnd,
};

/**
 * The end of the literal that opens at an index, if it is one.
 *
 * @param text - The SQL.
 * @param start - Where the opener was found.
 * @param opener - What was found: a quote, a comment start, or a heredoc tag.
 * @returns The index just past the literal, or `undefined` when the `$…$` opens no heredoc.
 */
function literalEnd(text: string, start: number, opener: string): number | undefined {
  const end = literalEnds[opener];
  return end ? end(text, start) : dollarQuoteEnd(text, start, opener);
}

/** The ClickHouse lexicon. */
export const clickhouseLexicon: SqlLexicon = { literalStart, literalEnd };
