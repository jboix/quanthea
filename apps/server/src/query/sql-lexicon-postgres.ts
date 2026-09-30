/**
 * How PostgreSQL writes its literals: standard and `E'…'` strings, quoted identifiers, dollar-quoted
 * bodies, line comments and nested block comments.
 */
import { lineCommentEnd, type SqlLexicon, stickyEnd, unterminated } from './sql-lexer.ts';

/** Where a literal may start: a quote, a comment, or a dollar-quote tag. */
const literalStart = /'|"|--|\/\*|\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/g;

/** A standard string, where `''` is an escaped quote. */
const standardString = /'(?:[^']|'')*'/y;

/** An `E'…'` string, where a backslash also escapes. */
const escapeString = /'(?:[^'\\]|\\[\s\S]|'')*'/y;

/** A quoted identifier, where `""` is an escaped quote. */
const quotedIdentifier = /"(?:[^"]|"")*"/y;

/** Characters that can continue an identifier, so a `$` after them is not a dollar quote. */
const identifierCharacter = /[A-Za-z0-9_$]/;

/**
 * The end of a block comment, which PostgreSQL allows to nest.
 *
 * @param text - The SQL.
 * @param start - Where the comment starts.
 * @returns The index just past the comment.
 * @throws {QueryError} When the comment is not closed.
 */
function blockCommentEnd(text: string, start: number): number {
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
  '/*': blockCommentEnd,
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
  if (end) return end(text, start);
  if (identifierCharacter.test(text[start - 1] ?? '')) return undefined;
  const close = text.indexOf(opener, start + opener.length);
  if (close === -1) throw unterminated();
  return close + opener.length;
}

/** The PostgreSQL lexicon. */
export const postgresLexicon: SqlLexicon = { literalStart, literalEnd };
