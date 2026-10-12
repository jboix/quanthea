/**
 * Finds the tables a SQL statement names: what follows FROM, JOIN, a comma of a FROM clause or
 * TABLE, without the names its own WITH clauses define. It reads names, not meaning: a view, a
 * function or a search path can reach a table the statement never names.
 */
import { QueryError } from '../query-error.ts';
import {
  afterParentheses,
  current,
  dottedName,
  isMark,
  isName,
  isWord,
  newLevel,
  type Scan,
  type SqlReads,
} from './sql-scan.ts';
import type { SqlToken } from './sql-tokens.ts';

/** Keywords that always end a FROM clause: no dialect takes one for an alias. */
const clauseEnds: ReadonlySet<string> = new Set(['where', 'having', 'union']);

/**
 * Keywords that end a FROM clause only when their own clause follows, since some dialect takes each
 * for an alias: `FROM orders settings, salaries`. Each says whether the tokens after it are its
 * clause's. The other clauses hold no comma outside parentheses, so they need no end.
 */
const clauseOpeners: Readonly<
  Record<string, (next: SqlToken | undefined, second: SqlToken | undefined) => boolean>
> = {
  group: (next) => isWord(next, 'by'),
  order: (next) => isWord(next, 'by'),
  limit: (next) => !(isMark(next, ',') || isMark(next, '(')),
  window: (next, second) => isName(next) && isWord(second, 'as'),
  settings: (next, second) => isName(next) && isMark(second, '='),
};

/** Keywords that can name no table, so one where a table goes is read as the keyword. */
const neverTables: ReadonlySet<string> = new Set(['select', 'from']);

/** The operators that join two queries. */
const setOperators: ReadonlySet<string> = new Set(['union', 'intersect', 'except']);

/** Words that may stand between FROM or JOIN and the table. */
const tablePrefixes: ReadonlySet<string> = new Set(['lateral', 'only']);

/** Words that start a query where a table goes, after an opening parenthesis. */
const queryStarts: ReadonlySet<string> = new Set(['select', 'with', 'values', 'table']);

/** Names that read no table. */
const noTable: ReadonlySet<string> = new Set(['dual']);

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
  if (!isName(token) || (token.kind === 'word' && neverTables.has(token.text))) return index - 1;
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

/**
 * Whether a TABLE at an index starts a query, as `TABLE name` does: first in the statement or in
 * parentheses, after a set operator, or after the last query of a WITH list.
 *
 * @param scan - The scan.
 * @param index - The index of the TABLE.
 * @returns `true` when a table follows.
 */
function startsQuery(scan: Scan, index: number): boolean {
  const before = scan.tokens[index - 1];
  if (before === undefined || isMark(before, '(')) return true;
  if (isMark(before, ')')) return current(scan).withList;
  if (before.kind !== 'word') return false;
  const quantified = before.text === 'all' || before.text === 'distinct';
  const operator = quantified ? scan.tokens[index - 2] : before;
  return operator?.kind === 'word' && setOperators.has(operator.text);
}

/**
 * Whether a keyword at an index ends the FROM clause of its level. A word after AS is an alias,
 * and a word some dialect takes for an alias ends the clause only when its own clause follows.
 *
 * @param scan - The scan.
 * @param index - The index of the keyword.
 * @returns `true` when a comma after it separates no tables.
 */
function endsFromClause(scan: Scan, index: number): boolean {
  const { tokens } = scan;
  const text = tokens[index]?.text ?? '';
  if (isWord(tokens[index - 1], 'as')) return false;
  if (clauseEnds.has(text)) return true;
  return clauseOpeners[text]?.(tokens[index + 1], tokens[index + 2]) ?? false;
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
    if (startsQuery(scan, index)) scan.expectTable = true;
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
    if (endsFromClause(scan, index)) current(scan).from = false;
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
