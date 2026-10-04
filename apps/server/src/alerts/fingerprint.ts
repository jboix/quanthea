/**
 * The fingerprint of a query: its connector, its language and its text normalised, so the same
 * query written with other spacing or comments matches. An alert and a dashboard panel whose
 * queries share a fingerprint watch the same thing. A builder's query is the query it rendered,
 * since a spec keeps only that.
 */
import type { QueryTemplate } from '@quanthea/shared';

/** How a text query language writes comments, and whether its words ignore case. */
interface Syntax {
  /** What starts a comment to the end of the line. */
  readonly lineComment: string;
  /** Whether `/* … *\/` comments exist. */
  readonly blockComments: boolean;
  /** Whether words outside quotes ignore case, as SQL keywords and plain names do. */
  readonly lowercase: boolean;
}

/** SQL: `--` and block comments; keywords and plain names ignore case. */
const sqlSyntax: Syntax = { lineComment: '--', blockComments: true, lowercase: true };

/** PromQL and LogQL: `#` comments; names keep their case. */
const expressionSyntax: Syntax = { lineComment: '#', blockComments: false, lowercase: false };

/** The characters that open a quoted string or name, kept as written. */
const quotes = new Set(["'", '"', '`']);

/** The characters around which spacing means nothing. */
const punctuation = new Set([...'()[]{},;=<>!+-*/%^|~:']);

/** A scan of a query's text. */
interface Scan {
  /** The text. */
  readonly text: string;
  /** Where the scan is. */
  index: number;
  /** The normalised text so far. */
  out: string;
  /** Whether spacing or a comment came since the last character kept. */
  space: boolean;
}

/**
 * Skips a comment at the scan's place, if one starts there.
 *
 * @param scan - The scan.
 * @param syntax - The language's comments.
 * @returns Whether it skipped one.
 */
function skipComment(scan: Scan, syntax: Syntax): boolean {
  const { text, index } = scan;
  let end: number;
  if (text.startsWith(syntax.lineComment, index)) end = text.indexOf('\n', index);
  else if (syntax.blockComments && text.startsWith('/*', index)) {
    end = text.indexOf('*/', index + 2);
    end = end < 0 ? end : end + 2;
  } else return false;
  scan.index = end < 0 ? text.length : end;
  scan.space = true;
  return true;
}

/**
 * Reads a quoted string or name from the scan's place, escapes included.
 *
 * @param scan - The scan, at the opening quote.
 * @returns The quoted text, quotes included.
 */
function readQuoted(scan: Scan): string {
  const { text, index } = scan;
  const quote = text[index];
  let end = index + 1;
  while (end < text.length && text[end] !== quote) end += text[end] === '\\' ? 2 : 1;
  scan.index = Math.min(end + 1, text.length);
  return text.slice(index, scan.index);
}

/**
 * Adds a piece to the normalised text, with one space before it only between two words.
 *
 * @param scan - The scan.
 * @param piece - The piece.
 */
function emit(scan: Scan, piece: string): void {
  const before = scan.out.at(-1);
  const between =
    before !== undefined && !punctuation.has(before) && !punctuation.has(piece.charAt(0));
  if (scan.space && between) scan.out += ' ';
  scan.space = false;
  scan.out += piece;
}

/**
 * Moves the scan one step: past a comment, spacing, a quoted part or one character.
 *
 * @param scan - The scan.
 * @param syntax - The language's syntax.
 */
function step(scan: Scan, syntax: Syntax): void {
  if (skipComment(scan, syntax)) return;
  const char = scan.text.charAt(scan.index);
  if (/\s/.test(char)) {
    scan.space = true;
    scan.index += 1;
  } else if (quotes.has(char)) emit(scan, readQuoted(scan));
  else {
    emit(scan, syntax.lowercase ? char.toLowerCase() : char);
    scan.index += 1;
  }
}

/**
 * Normalises a query's text: comments dropped, spacing collapsed to one space between words and
 * none around punctuation, a final semicolon dropped, and words lowercased where case means
 * nothing. Quoted parts stay as written.
 *
 * @param text - The text.
 * @param syntax - The language's syntax.
 * @returns The normalised text.
 */
function normaliseText(text: string, syntax: Syntax): string {
  const scan: Scan = { text, index: 0, out: '', space: false };
  while (scan.index < text.length) step(scan, syntax);
  return scan.out.replace(/;$/, '');
}

/**
 * Writes JSON with every object's keys in order, so the same document always reads the same.
 *
 * @param value - The value.
 * @returns The JSON.
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, each]) => each !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries.map(([key, each]) => `${JSON.stringify(key)}:${canonicalJson(each)}`).join(',')}}`;
}

/**
 * The normalised body of a query, by language.
 *
 * @param query - The query.
 * @returns The normalised text.
 */
function normalisedBody(query: QueryTemplate): string {
  switch (query.language) {
    case 'sql':
      return normaliseText(query.sql, sqlSyntax);
    case 'promql':
    case 'logql':
      return normaliseText(query.expr, expressionSyntax);
    case 'search':
      return `${query.index}\n${canonicalJson(query.body)}`;
    case 'mongodb':
      return `${query.collection}\n${canonicalJson(query.pipeline)}`;
    case 'redis':
      return [query.command.toUpperCase(), ...query.args].join(' ');
    default:
      return canonicalJson([query.method, query.path, query.query, query.body, query.extract]);
  }
}

/**
 * The fingerprint of a query: the connector, the language and the normalised text. The refId,
 * the step and whether it is instant are left out: they change how a result is read, not what
 * is measured.
 *
 * @param query - The query.
 * @returns The fingerprint.
 */
export function queryFingerprint(query: QueryTemplate): string {
  return JSON.stringify([query.connector, query.language, normalisedBody(query)]);
}
