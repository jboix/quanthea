/**
 * How PostgreSQL writes its literals: standard and `E'…'` strings, quoted identifiers, dollar-quoted
 * bodies, line comments and nested block comments.
 */
import {
  dollarQuoteEnd,
  identifierCharacter,
  lineCommentEnd,
  nestedCommentEnd,
  type SqlLexicon,
  stickyEnd,
} from './sql-lexer.ts';

/** Where a literal may start: a quote, a comment, or a dollar-quote tag. */
const literalStart = /'|"|--|\/\*|\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/g;

/** A standard string, where `''` is an escaped quote. */
const standardString = /'(?:[^']|'')*'/y;

/** An `E'…'` string, where a backslash also escapes. */
const escapeString = /'(?:[^'\\]|\\[\s\S]|'')*'/y;

/** A quoted identifier, where `""` is an escaped quote. */
const quotedIdentifier = /"(?:[^"]|"")*"/y;

/**
 * The end of a string: an `E'…'` string when the quote follows a lone `E`.
 *
 * @param text - The SQL.
 * @param start - Where the quote is.
 * @returns The index just past the string.
 */
function stringEnd(text: string, start: number): number {
  const escaped =
    /[Ee]/.test(text[start - 1] ?? '') && !identifierCharacter.test(text[start - 2] ?? '');
  return stickyEnd(escaped ? escapeString : standardString, text, start);
}

/** The end of each kind of literal, by how it opens. */
const literalEnds: Readonly<Record<string, (text: string, start: number) => number>> = {
  "'": stringEnd,
  '"': (text, start) => stickyEnd(quotedIdentifier, text, start),
  '--': lineCommentEnd,
  '/*': nestedCommentEnd,
};

/**
 * The end of the literal that opens at an index, if it is one.
 *
 * @param text - The SQL.
 * @param start - Where the opener was found.
 * @param opener - What was found: a quote, a comment start, or a dollar tag.
 * @returns The index just past the literal, or `undefined` when the `$…$` is not a dollar quote.
 */
function literalEnd(text: string, start: number, opener: string): number | undefined {
  const end = literalEnds[opener];
  return end ? end(text, start) : dollarQuoteEnd(text, start, opener);
}

/** The PostgreSQL lexicon. */
export const postgresLexicon: SqlLexicon = { literalStart, literalEnd };
