/**
 * The session `sql_mode` quanthea pins on MySQL and MariaDB: the server's, without the modes that
 * change how a statement is read. The SQL binder lexes strings with backslash escapes and reads a
 * double-quoted text as a string, so `ANSI_QUOTES` and `NO_BACKSLASH_ESCAPES` would let the server
 * read a statement otherwise, such as an `INTO OUTFILE` the binder took for a literal.
 */

/**
 * The modes dropped: those two, and the combined modes that set them (`ANSI`, `DB2`, `MAXDB`,
 * `MSSQL`, `ORACLE`, `POSTGRESQL`). `ORACLE` also switches MariaDB to another grammar.
 */
const droppedModes = new Set([
  'ANSI_QUOTES',
  'NO_BACKSLASH_ESCAPES',
  'ANSI',
  'DB2',
  'MAXDB',
  'MSSQL',
  'ORACLE',
  'POSTGRESQL',
]);

/** A mode name, the only text the pinned mode holds. */
const modeName = /^[A-Z][A-Z0-9_]*$/;

/**
 * The session mode to pin, from the server's.
 *
 * @param serverMode - The session's `@@sql_mode`, comma-separated.
 * @returns The mode names to keep, comma-separated: only names, so it can be written as a literal.
 */
export function pinnedSqlMode(serverMode: string): string {
  return serverMode
    .split(',')
    .map((mode) => mode.trim().toUpperCase())
    .filter((mode) => modeName.test(mode) && !droppedModes.has(mode))
    .join(',');
}
