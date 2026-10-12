/**
 * Finds the tables a SQL statement names: what follows FROM, JOIN, a comma of a FROM clause or
 * TABLE, without the names its own WITH clauses define. It reads names, not meaning: a view, a
 * function or a search path can reach a table the statement never names.
 */
import { QueryError } from '../query-error.ts';
import type { SqlToken } from './sql-tokens.ts';

/** What a statement reads, as far as its text says. */
export interface SqlReads {
  /** The tables named, each as its parts: `schema`, `table`. */
  readonly tables: string[][];
  /** The functions called where a table goes, each as its parts. */
  readonly tableFunctions: string[][];
  /** Every function called, in lower case. */
  readonly calls: Set<string>;
}

/** One level of parentheses. */
interface Level {
  /** Whether a SELECT was seen at this level, so a FROM opens a clause here. */
  select: boolean;
  /** Whether a comma at this level separates tables. */
  from: boolean;
  /** Whether a WITH list is open at this level. */
  withList: boolean;
  /** The names the WITH clauses of this level define, in lower case. */
  readonly defined: Set<string>;
}

/** The scan of one statement. */
interface Scan {
  /** The tokens. */
  readonly tokens: readonly SqlToken[];
  /** The open levels, outermost first. */
  readonly levels: Level[];
  /** Whether the next token starts a table. */
  expectTable: boolean;
  /** What was found. */
  readonly reads: SqlReads;
}

/** Keywords that end a FROM clause. */
const clauseEnds: ReadonlySet<string> = new Set([
  'where',
  'group',
  'having',
  'order',
  'limit',
  'offset',
  'fetch',
  'union',
  'intersect',
  'except',
  'window',
  'qualify',
  'prewhere',
  'settings',
  'format',
]);

/** Words that may stand between FROM or JOIN and the table. */
const tablePrefixes: ReadonlySet<string> = new Set(['lateral', 'only']);

/** Words that start a query where a table goes, after an opening parenthesis. */
const queryStarts: ReadonlySet<string> = new Set(['select', 'with', 'values', 'table']);

/** Names that read no table. */
const noTable: ReadonlySet<string> = new Set(['dual']);

/**
 * A new level.
 *
 * @returns The level, with nothing seen.
 */
function newLevel(): Level {
  return { select: false, from: false, withList: false, defined: new Set() };
}

/**
 * The innermost open level.
 *
 * @param scan - The scan.
 * @returns The level.
 */
function current(scan: Scan): Level {
  const level = scan.levels.at(-1);
  if (level) return level;
  const root = newLevel();
  scan.levels.push(root);
  return root;
}

/**
 * Whether a token is the given mark.
 *
 * @param token - The token.
 * @param text - The mark.
 * @returns `true` when it is.
 */
function isMark(token: SqlToken | undefined, text: string): boolean {
  return token?.kind === 'mark' && token.text === text;
}

/**
 * Whether a token is the given keyword.
 *
 * @param token - The token.
 * @param text - The keyword, in lower case.
 * @returns `true` when it is.
 */
function isWord(token: SqlToken | undefined, text: string): boolean {
  return token?.kind === 'word' && token.text === text;
}

/**
 * Whether a token can name something.
 *
 * @param token - The token.
 * @returns `true` for a bare or quoted identifier.
 */
function isName(token: SqlToken | undefined): token is SqlToken {
  return token?.kind === 'word' || token?.kind === 'name';
}

/**
 * Reads a dotted name.
 *
 * @param tokens - The tokens.
 * @param start - The index of its first part.
 * @returns The parts and the index after them.
 */
function dottedName(tokens: readonly SqlToken[], start: number): { parts: string[]; end: number } {
  const parts = [tokens[start]?.text ?? ''];
  let end = start + 1;
  while (isMark(tokens[end], '.') && isName(tokens[end + 1])) {
    parts.push(tokens[end + 1]?.text ?? '');
    end += 2;
  }
  return { parts, end };
}

/**
 * Whether a name is one a WITH clause in scope defines.
 *
 * @param scan - The scan.
 * @param parts - The name's parts.
 * @returns `true` when the name reads that clause's rows, not a table.
 */
function definedHere(scan: Scan, parts: readonly string[]): boolean {
  const name = (parts[0] ?? '').toLowerCase();
  return parts.length === 1 && scan.levels.some((level) => level.defined.has(name));
}

/**
 * Refuses a Unicode-escaped identifier, `U&"…"`, whose name this reader would not see.
 *
 * @param scan - The scan.
 * @param index - The index of the token where a table goes.
 * @throws {QueryError} `invalid` for such an identifier.
 */
function refuseEscapedName(scan: Scan, index: number): void {
  const { tokens } = scan;
  if (!(isWord(tokens[index], 'u') && isMark(tokens[index + 1], '&'))) return;
  if (tokens[index + 2]?.kind !== 'name') return;
  throw new QueryError('invalid', 'Write a table name as it is, without Unicode escapes.');
}

/**
 * Notes a function called where a table goes.
 *
 * @param scan - The scan.
 * @param parts - The function's name, as its parts.
 */
function noteTableFunction(scan: Scan, parts: string[]): void {
  scan.reads.tableFunctions.push(parts);
  scan.reads.calls.add((parts.at(-1) ?? '').toLowerCase());
}

/**
 * Reads what stands where a table goes: a name, a function call, or the start of a subquery.
 *
 * @param scan - The scan.
 * @param index - The index of the token.
 * @returns The index of the last token read.
 */
function readTable(scan: Scan, index: number): number {
  const token = scan.tokens[index];
  scan.expectTable = false;
  if (!isName(token)) return index - 1;
  if (token.kind === 'word' && tablePrefixes.has(token.text)) {
    scan.expectTable = true;
    return index;
  }
  refuseEscapedName(scan, index);
  const { parts, end } = dottedName(scan.tokens, index);
  if (isMark(scan.tokens[end], '(')) noteTableFunction(scan, parts);
  else if (!definedHere(scan, parts) && !noTable.has(parts.join('.').toLowerCase()))
    scan.reads.tables.push(parts);
  return end - 1;
}

/**
 * The index after a parenthesised list that opens at an index.
 *
 * @param tokens - The tokens.
 * @param open - The index of the opening parenthesis.
 * @returns The index after its closing parenthesis.
 */
function afterParentheses(tokens: readonly SqlToken[], open: number): number {
  let depth = 0;
  for (let index = open; index < tokens.length; index += 1) {
    if (isMark(tokens[index], '(')) depth += 1;
    if (isMark(tokens[index], ')')) depth -= 1;
    if (depth === 0) return index + 1;
  }
  return tokens.length;
}

/**
 * Whether a name at an index is defined by a WITH clause: `name AS (`, with an optional column
 * list and MATERIALIZED.
 *
 * @param tokens - The tokens.
 * @param index - The index of the name.
 * @returns `true` when the name is a WITH query's.
 */
function definesQuery(tokens: readonly SqlToken[], index: number): boolean {
  let next = index + 1;
  if (isMark(tokens[next], '(')) next = afterParentheses(tokens, next);
  if (!isWord(tokens[next], 'as')) return false;
  next += 1;
  while (isWord(tokens[next], 'not') || isWord(tokens[next], 'materialized')) next += 1;
  return isMark(tokens[next], '(');
}

/**
 * Notes the name a WITH clause defines, when the token at an index is one.
 *
 * @param scan - The scan.
 * @param index - The index of the token.
 */
function noteDefinition(scan: Scan, index: number): void {
  const level = current(scan);
  const token = scan.tokens[index];
  const before = scan.tokens[index - 1];
  if (!(level.withList && isName(token))) return;
  const opens = isWord(before, 'with') || isWord(before, 'recursive') || isMark(before, ',');
  if (opens && definesQuery(scan.tokens, index)) level.defined.add(token.text.toLowerCase());
}

/**
 * Whether a FROM at an index opens a clause: after a SELECT of its level or first in it (as
 * ClickHouse allows), and not the FROM of `IS DISTINCT FROM`.
 *
 * @param scan - The scan.
 * @param index - The index of the FROM.
 * @returns `true` when a table follows.
 */
function opensFromClause(scan: Scan, index: number): boolean {
  const before = scan.tokens[index - 1];
  if (isWord(before, 'distinct')) {
    const earlier = scan.tokens[index - 2];
    if (isWord(earlier, 'is') || isWord(earlier, 'not')) return false;
  }
  if (current(scan).select || before === undefined) return true;
  // TRIM(FROM text) is the one function whose arguments start with FROM.
  return isMark(before, '(') && !isWord(scan.tokens[index - 2], 'trim');
}

/** What each keyword does to the scan. */
const keywordActions: Readonly<Record<string, (scan: Scan, index: number) => void>> = {
  select: (scan) => {
    Object.assign(current(scan), { select: true, from: false, withList: false });
  },
  with: (scan) => {
    current(scan).withList = true;
  },
  from: (scan, index) => {
    if (!opensFromClause(scan, index)) return;
    current(scan).from = true;
    scan.expectTable = true;
  },
  join: (scan, index) => {
    // ClickHouse's ARRAY JOIN takes arrays, not tables.
    const arrays = isWord(scan.tokens[index - 1], 'array');
    current(scan).from = !arrays;
    scan.expectTable = !arrays;
  },
  straight_join: (scan) => {
    current(scan).from = true;
    scan.expectTable = true;
  },
  table: (scan, index) => {
    const before = scan.tokens[index - 1];
    if (before === undefined || isMark(before, '(')) scan.expectTable = true;
  },
};

/**
 * Applies a keyword or a mark to the scan.
 *
 * @param scan - The scan.
 * @param index - The index of the token.
 */
function applyToken(scan: Scan, index: number): void {
  const token = scan.tokens[index];
  // After a dot a word is a column or a table, whatever it spells.
  if (token?.kind === 'word' && !isMark(scan.tokens[index - 1], '.')) {
    if (clauseEnds.has(token.text)) current(scan).from = false;
    keywordActions[token.text]?.(scan, index);
    return;
  }
  if (isMark(token, ')') && scan.levels.length > 1) scan.levels.pop();
  if (isMark(token, ',') && current(scan).from) scan.expectTable = true;
}

/**
 * Opens a level of parentheses. Where a table goes, the level holds a subquery or a joined group
 * of tables, whose first name is a table too.
 *
 * @param scan - The scan.
 * @param index - The index of the parenthesis.
 */
function openLevel(scan: Scan, index: number): void {
  const level = newLevel();
  const next = scan.tokens[index + 1];
  const grouped = scan.expectTable && !(next?.kind === 'word' && queryStarts.has(next.text));
  if (grouped) Object.assign(level, { select: true, from: true });
  scan.expectTable = grouped;
  scan.levels.push(level);
}

/**
 * Notes a function call, when the token at an index is its name.
 *
 * @param scan - The scan.
 * @param index - The index of the token.
 */
function noteCall(scan: Scan, index: number): void {
  const token = scan.tokens[index];
  if (isName(token) && isMark(scan.tokens[index + 1], '('))
    scan.reads.calls.add(token.text.toLowerCase());
}

/**
 * Reads one token.
 *
 * @param scan - The scan.
 * @param index - The index of the token.
 * @returns The index of the last token read.
 */
function step(scan: Scan, index: number): number {
  noteCall(scan, index);
  if (isMark(scan.tokens[index], '(')) {
    openLevel(scan, index);
    return index;
  }
  if (scan.expectTable) return readTable(scan, index);
  noteDefinition(scan, index);
  applyToken(scan, index);
  return index;
}

/**
 * The tables and functions a statement names.
 *
 * @param tokens - The statement's tokens.
 * @returns What it reads, as far as its text says.
 * @throws {QueryError} `invalid` for a table written with Unicode escapes.
 */
export function sqlReads(tokens: readonly SqlToken[]): SqlReads {
  const reads: SqlReads = { tables: [], tableFunctions: [], calls: new Set() };
  const scan: Scan = { tokens, levels: [newLevel()], expectTable: false, reads };
  for (let index = 0; index < tokens.length; index += 1) index = step(scan, index);
  return reads;
}
