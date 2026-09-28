/**
 * Splits PostgreSQL text into code, which the binder may rewrite, and literals (strings, quoted
 * identifiers, dollar-quoted bodies, comments), which it must leave alone.
 */
import { QueryError } from './query-error.ts';

/** A run of SQL text. */
export interface SqlSegment {
  /** `code` may hold variables and keywords; `literal` is copied as is. */
  readonly kind: 'code' | 'literal';
  /** The text. */
  readonly text: string;
}

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
 * The error for a literal that is not closed.
 *
 * @returns The error.
 */
function unterminated(): QueryError {
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
function stickyEnd(pattern: RegExp, text: string, start: number): number {
  pattern.lastIndex = start;
  const match = pattern.exec(text);
  if (!match) throw unterminated();
  return start + match[0].length;
}

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
  '--': (text, start) => {
    const newline = text.indexOf('\n', start);
    return newline === -1 ? text.length : newline;
  },
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

/**
 * Splits SQL into code and literals.
 *
 * @param text - The SQL.
 * @returns The segments, in order; joined, they are the input.
 * @throws {QueryError} `invalid` when a string, identifier or comment is not closed.
 */
export function splitSql(text: string): SqlSegment[] {
  const segments: SqlSegment[] = [];
  const starts = new RegExp(literalStart.source, 'g');
  let codeStart = 0;
  for (let match = starts.exec(text); match; match = starts.exec(text)) {
    const end = literalEnd(text, match.index, match[0]);
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
