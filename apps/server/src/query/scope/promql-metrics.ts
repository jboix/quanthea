/**
 * Finds the metrics a PromQL expression names: a bare name, a quoted name in braces, or an
 * equality on `__name__`. A selector that names no metric, or matches `__name__` any other way,
 * can read any metric, and is reported as such.
 */
import { type PromqlSegment, splitPromql } from '../promql-binder.ts';

/** What an expression reads. */
export interface PromqlReads {
  /** The metrics it names. */
  readonly metrics: string[];
  /** Whether a selector can read metrics it does not name. */
  unnamed: boolean;
}

/** One token of an expression. */
interface Token {
  /** A `word`, a `string` (without its quotes), a `number` or a `mark`. */
  readonly kind: 'word' | 'string' | 'number' | 'mark';
  /** The text. */
  readonly text: string;
  /** For a string: whether its text is certain, with no escape to work out. */
  readonly plain?: boolean;
}

/** The scan of one expression. */
interface Scan {
  /** The tokens. */
  readonly tokens: readonly Token[];
  /** What was found. */
  readonly reads: PromqlReads;
  /** Whether the scan is inside the label list of `by`, `on` and their like. */
  inLabels: boolean;
  /** How many `[` are open: durations and subquery steps. */
  brackets: number;
  /** Whether the selector being read has a metric name. */
  named: boolean;
  /** Whether the scan is inside the braces of a selector. */
  inBraces: boolean;
}

/** A word, a number or duration, or one mark. */
const codeToken = /([A-Za-z_:][A-Za-z0-9_:]*)|(\d[A-Za-z0-9_.]*)|\S/g;

/** Keywords that take a list of labels in parentheses. */
const labelKeywords: ReadonlySet<string> = new Set([
  'by',
  'without',
  'on',
  'ignoring',
  'group_left',
  'group_right',
]);

/** Words that are operators, modifiers or numbers, never metrics. */
const keywords: ReadonlySet<string> = new Set([
  ...labelKeywords,
  'and',
  'or',
  'unless',
  'bool',
  'offset',
  'atan2',
  'inf',
  'nan',
]);

/**
 * The tokens of a segment.
 *
 * @param segment - A run of code, a string or a comment.
 * @returns Its tokens; none for a comment.
 */
function segmentTokens(segment: PromqlSegment): Token[] {
  if (segment.kind === 'comment') return [];
  if (segment.kind === 'string') {
    const raw = segment.text.startsWith('`') || !segment.text.includes('\\');
    return [{ kind: 'string', text: segment.text.slice(1, -1), plain: raw }];
  }
  return [...segment.text.matchAll(codeToken)].map((match): Token => {
    if (match[1] !== undefined) return { kind: 'word', text: match[1] };
    return { kind: match[2] === undefined ? 'mark' : 'number', text: match[0] };
  });
}

/**
 * Whether a token is the given mark.
 *
 * @param token - The token.
 * @param text - The mark.
 * @returns `true` when it is.
 */
function isMark(token: Token | undefined, text: string): boolean {
  return token?.kind === 'mark' && token.text === text;
}

/**
 * Notes a metric a selector names with a string: taken when its text is certain.
 *
 * @param scan - The scan.
 * @param token - The string.
 */
function noteQuoted(scan: Scan, token: Token): void {
  if (!token.plain) return;
  scan.reads.metrics.push(token.text);
  scan.named = true;
}

/**
 * Reads a `__name__` matcher: an equality names a metric, anything else names none.
 *
 * @param scan - The scan.
 * @param index - The index of `__name__`.
 */
function readNameMatcher(scan: Scan, index: number): void {
  const { tokens } = scan;
  const equality = isMark(tokens[index + 1], '=') && tokens[index + 2]?.kind === 'string';
  if (equality) noteQuoted(scan, tokens[index + 2] as Token);
}

/**
 * Whether a string in braces stands alone, as a quoted metric name does: after `{` or a comma,
 * with no matcher operator after it.
 *
 * @param tokens - The tokens.
 * @param index - The index of the string.
 * @returns `true` when the string is no label name and no matcher value.
 */
function standsAlone(tokens: readonly Token[], index: number): boolean {
  const before = tokens[index - 1];
  const after = tokens[index + 1];
  if (isMark(after, '=') || isMark(after, '!')) return false;
  return isMark(before, '{') || isMark(before, ',');
}

/**
 * Reads one token inside the braces of a selector.
 *
 * @param scan - The scan.
 * @param index - The index of the token.
 */
function readInBraces(scan: Scan, index: number): void {
  const token = scan.tokens[index];
  if (isMark(token, '}')) {
    if (!scan.named) scan.reads.unnamed = true;
    scan.inBraces = false;
    return;
  }
  if (token?.kind === 'word' && token.text === '__name__') readNameMatcher(scan, index);
  if (token?.kind === 'string' && standsAlone(scan.tokens, index)) noteQuoted(scan, token);
}

/**
 * Reads a word outside braces: a metric unless it is a keyword or a function.
 *
 * @param scan - The scan.
 * @param index - The index of the word.
 * @returns Whether the word is a metric.
 */
function readWord(scan: Scan, index: number): boolean {
  const word = scan.tokens[index]?.text ?? '';
  const called = isMark(scan.tokens[index + 1], '(');
  if (labelKeywords.has(word.toLowerCase()) && called) {
    scan.inLabels = true;
    return false;
  }
  const next = scan.tokens[index + 1];
  const aggregates = next?.kind === 'word' && labelKeywords.has(next.text.toLowerCase());
  if (called || aggregates || keywords.has(word.toLowerCase())) return false;
  scan.reads.metrics.push(word);
  return true;
}

/**
 * Opens the braces of a selector.
 *
 * @param scan - The scan.
 * @param afterMetric - Whether a metric name stands just before them.
 */
function openBraces(scan: Scan, afterMetric: boolean): void {
  scan.inBraces = true;
  scan.named = afterMetric;
}

/**
 * Reads one token outside braces.
 *
 * @param scan - The scan.
 * @param index - The index of the token.
 * @param afterMetric - Whether the token before it was a metric name.
 * @returns Whether this token is a metric name.
 */
function readOutside(scan: Scan, index: number, afterMetric: boolean): boolean {
  const token = scan.tokens[index];
  if (isMark(token, '[')) scan.brackets += 1;
  if (isMark(token, ']')) scan.brackets -= 1;
  if (isMark(token, '{')) openBraces(scan, afterMetric);
  if (token?.kind !== 'word' || scan.brackets > 0) return false;
  return readWord(scan, index);
}

/**
 * Reads one token.
 *
 * @param scan - The scan.
 * @param index - The index of the token.
 * @param afterMetric - Whether the token before it was a metric name.
 * @returns Whether this token is a metric name.
 */
function step(scan: Scan, index: number, afterMetric: boolean): boolean {
  if (scan.inLabels) {
    if (isMark(scan.tokens[index], ')')) scan.inLabels = false;
    return false;
  }
  if (scan.inBraces) {
    readInBraces(scan, index);
    return false;
  }
  return readOutside(scan, index, afterMetric);
}

/**
 * The metrics an expression names.
 *
 * @param expression - The PromQL, with its variables bound.
 * @returns The metrics, and whether a selector can read others.
 * @throws {QueryError} `invalid` when a string is not closed.
 */
export function promqlReads(expression: string): PromqlReads {
  const tokens = splitPromql(expression).flatMap(segmentTokens);
  const reads: PromqlReads = { metrics: [], unnamed: false };
  const scan: Scan = { tokens, reads, inLabels: false, brackets: 0, named: false, inBraces: false };
  let afterMetric = false;
  for (let index = 0; index < tokens.length; index += 1)
    afterMetric = step(scan, index, afterMetric);
  return reads;
}
