/**
 * The code of a SQL statement, for the checks that read what a query does from its text: its
 * comments dropped and its strings emptied, so a word in either is not read as code. It is a
 * reading aid of those checks, not the binder's lexer: it knows the quotes every dialect shares.
 */

/** A string, a dollar-quoted string, a comment or a quoted identifier, whichever starts first. */
const literal =
  /'(?:[^'\\]|\\.|'')*'|\$(\w*)\$[\s\S]*?\$\1\$|--[^\n]*|\/\*[\s\S]*?\*\/|"(?:[^"]|"")*"|`[^`]*`/g;

/**
 * What a literal leaves in the code.
 *
 * @param text - The literal, as written.
 * @returns `''` for a string, a space for a comment, and a quoted identifier as it is.
 */
function emptied(text: string): string {
  if (text.startsWith("'") || text.startsWith('$')) return "''";
  return text.startsWith('-') || text.startsWith('/') ? ' ' : text;
}

/**
 * The code of a statement.
 *
 * @param sql - The statement.
 * @returns The statement with each comment replaced by a space and each string by `''`.
 */
export function sqlCodeOf(sql: string): string {
  return sql.replace(literal, emptied);
}
