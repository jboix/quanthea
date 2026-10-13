/**
 * Refuses the functions through which one read statement reaches past its own tables: a file of
 * the server, another server, a program, text run as SQL, or the server's own controls. A
 * read-only transaction stops none of them, since none writes a table. The lists hold the
 * functions each source ships. A role without the right to call them is the guarantee.
 */
import { QueryError } from './query-error.ts';
import { type SqlToken, sqlTokens } from './scope/sql-tokens.ts';
import type { SqlFlavor } from './sql-dialects.ts';

/** A group of functions refused for one reason. */
interface Refusal {
  /** The names, in lower case, as one pattern. */
  readonly names: RegExp;
  /** What the functions do, after "it". */
  readonly reason: string;
}

/** The PostgreSQL functions refused. */
const postgresRefusals: readonly Refusal[] = [
  {
    names: /^(?:pg_read_(?:binary_)?file|pg_ls_\w*dir|pg_stat_file|pg_file_\w+|pg_logdir_ls)$/,
    reason: "reads or writes the server's files",
  },
  { names: /^lo_(?:import|export)$/, reason: "reads or writes the server's files" },
  { names: /^dblink\w*$/, reason: 'reaches another server' },
  {
    names:
      /^(?:query_to_xml\w*|cursor_to_xml\w*|ts_stat|ts_rewrite|crosstab\d?|connectby|xpath_table)$/,
    reason: 'runs text as SQL, which no check reads',
  },
  {
    names:
      /^pg_(?:terminate_backend|cancel_backend|reload_conf|rotate_logfile|switch_wal|promote|create_restore_point|backup_st\w+|start_backup|stop_backup|\w*replication_slot\w*|logical_slot_\w+|logical_emit_message|replication_origin_\w+|wal_replay_\w+|stat_reset\w*|(?:try_)?advisory_lock(?:_shared)?)$/,
    reason: 'changes the server outside the read-only transaction',
  },
  { names: /^set_config$/, reason: 'changes the settings of the session' },
];

/** The MySQL and MariaDB functions refused. */
const mysqlRefusals: readonly Refusal[] = [
  { names: /^load_file$/, reason: "reads the server's files" },
  { names: /^sys_(?:exec|eval)$/, reason: 'runs a program on the server' },
  { names: /^get_lock$/, reason: 'takes a lock that outlives the query' },
];

/** The ClickHouse functions refused: the table functions that read outside the server's tables. */
const clickhouseRefusals: readonly Refusal[] = [
  {
    names:
      /^(?:(?:file|s3|gcs|cosn|oss|hdfs|azureblobstorage)(?:cluster)?|(?:iceberg|deltalake|paimon)(?:s3|azure|hdfs|local)?(?:cluster)?|hudi(?:cluster)?|hive)$/,
    reason: 'reads files or object storage',
  },
  {
    names:
      /^(?:url(?:cluster)?|remote(?:secure)?|cluster(?:allreplicas)?|mysql|postgresql|mongodb|redis|sqlite|jdbc|odbc|ytsaurus|arrowflight)$/,
    reason: 'reaches another server',
  },
  { names: /^(?:executable|input)$/, reason: 'runs a program or reads what the request sends' },
];

/** The Trino table functions that send text to the source under a catalog. */
const trinoPassThrough: ReadonlySet<string> = new Set(['query', 'raw_query', 'procedure']);

/** The refusals of each dialect that has some. */
const refusalsByDialect: Readonly<Partial<Record<string, readonly Refusal[]>>> = {
  postgres: postgresRefusals,
  mysql: mysqlRefusals,
  clickhouse: clickhouseRefusals,
};

/**
 * The error for a refused function.
 *
 * @param name - The function, as the statement names it.
 * @param reason - What it does, after "it".
 * @returns The error.
 */
function refused(name: string, reason: string): QueryError {
  return new QueryError('invalid', `A query cannot call ${name}(): it ${reason}.`);
}

/**
 * Whether a token can name a function.
 *
 * @param token - The token.
 * @returns `true` for a bare or quoted identifier.
 */
function namesFunction(token: SqlToken | undefined): token is SqlToken {
  return token?.kind === 'word' || token?.kind === 'name';
}

/**
 * Whether the tokens at an index open a call: a name and an opening parenthesis.
 *
 * @param tokens - The statement's tokens.
 * @param index - The index of the name.
 * @returns `true` for a call.
 */
function isCall(tokens: readonly SqlToken[], index: number): boolean {
  const next = tokens[index + 1];
  return namesFunction(tokens[index]) && next?.kind === 'mark' && next.text === '(';
}

/**
 * Refuses a function named with Unicode escapes, `U&"…"(`, whose name the lists would not match.
 *
 * @param tokens - The statement's tokens.
 * @param index - The index of the function's name.
 * @throws {QueryError} `invalid` for such a name.
 */
function refuseEscapedName(tokens: readonly SqlToken[], index: number): void {
  const [letter, mark] = [tokens[index - 2], tokens[index - 1]];
  if (tokens[index]?.kind !== 'name' || mark?.text !== '&') return;
  if (letter?.kind === 'word' && letter.text === 'u')
    throw new QueryError('invalid', 'Write a function name as it is, without Unicode escapes.');
}

/**
 * Refuses a Trino table function that sends its text to the source under a catalog, where it runs
 * unread: `TABLE(catalog.system.query(query => '…'))`. A name of that spelling that follows
 * neither a dot nor `TABLE(` is the statement's own, such as a WITH query.
 *
 * @param tokens - The statement's tokens.
 * @param index - The index of the function's name.
 * @throws {QueryError} `invalid` for such a function.
 */
function refusePassThrough(tokens: readonly SqlToken[], index: number): void {
  const name = tokens[index]?.text.toLowerCase() ?? '';
  if (!trinoPassThrough.has(name)) return;
  const [second, before] = [tokens[index - 2], tokens[index - 1]];
  const qualified = before?.kind === 'mark' && before.text === '.';
  const inTable = before?.text === '(' && second?.kind === 'word' && second.text === 'table';
  if (qualified || inTable)
    throw refused(name, 'sends text to the source under a catalog, which no check reads');
}

/**
 * Checks one call against the dialect's lists.
 *
 * @param tokens - The statement's tokens.
 * @param index - The index of the function's name.
 * @param dialect - The dialect's name.
 * @throws {QueryError} `invalid` for a refused function.
 */
function checkCall(tokens: readonly SqlToken[], index: number, dialect: string): void {
  refuseEscapedName(tokens, index);
  if (dialect === 'trino') refusePassThrough(tokens, index);
  const name = tokens[index]?.text.toLowerCase() ?? '';
  const refusal = (refusalsByDialect[dialect] ?? []).find(({ names }) => names.test(name));
  if (refusal) throw refused(name, refusal.reason);
}

/**
 * Checks that a statement calls no function that reaches past its own tables.
 *
 * @param text - The statement.
 * @param flavor - The connector's dialect.
 * @throws {QueryError} `invalid` for a function that reads or writes a file, reaches another
 *   server, runs a program or text as SQL, or changes the server, and for an unclosed literal.
 */
export function checkSqlReach(text: string, flavor: SqlFlavor): void {
  const dialect = typeof flavor === 'string' ? flavor : flavor.dialect;
  const tokens = sqlTokens(text, flavor);
  for (let index = 0; index < tokens.length; index += 1) {
    if (isCall(tokens, index)) checkCall(tokens, index, dialect);
  }
}
