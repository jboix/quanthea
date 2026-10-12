/**
 * Checks the tables a SQL statement names against what its connector shows. It is best effort: it
 * reads the names after FROM, JOIN and TABLE and refuses the functions known to read a table by
 * name, but a view, another function or the search path can reach a table the text never names.
 * A database role that cannot read the table is the guarantee.
 */
import { QueryError } from '../query-error.ts';
import type { SqlFlavor } from '../sql-dialects.ts';
import {
  isSystemTable,
  notShown,
  type ObjectFamily,
  type ObjectScope,
  requireShown,
  restricts,
} from './object-scope.ts';
import { sqlReads } from './sql-tables.ts';
import { sqlTokens } from './sql-tokens.ts';

/** The functions that read a table named in text or by pattern, by family, in lower case. */
const readerFunctions: Readonly<Partial<Record<ObjectFamily, readonly string[]>>> = {
  postgres: [
    'query_to_xml',
    'query_to_xml_and_xmlschema',
    'query_to_xmlschema',
    'table_to_xml',
    'table_to_xml_and_xmlschema',
    'schema_to_xml',
    'schema_to_xml_and_xmlschema',
    'database_to_xml',
    'database_to_xml_and_xmlschema',
    'dblink',
  ],
  clickhouse: [
    'merge',
    'remote',
    'remotesecure',
    'cluster',
    'clusterallreplicas',
    'dictionary',
    'loop',
  ],
};

/**
 * Refuses a table or a table function of the source's own, unless the connector shows them.
 *
 * @param scope - The connector's scope.
 * @param parts - The name's parts.
 * @throws {QueryError} `invalid` for a system name the connector hides.
 */
function refuseSystem(scope: ObjectScope, parts: readonly string[]): void {
  if (scope.visibility.showSystem || !isSystemTable(scope.family, parts)) return;
  throw notShown(parts.join('.'));
}

/**
 * Refuses a function that reads a table named in text or by pattern, which no list can check.
 *
 * @param scope - The connector's scope.
 * @param calls - The functions the statement calls, in lower case.
 * @throws {QueryError} `invalid` for such a function.
 */
function refuseReaders(scope: ObjectScope, calls: ReadonlySet<string>): void {
  const reader = (readerFunctions[scope.family] ?? []).find((name) => calls.has(name));
  if (reader === undefined) return;
  throw new QueryError(
    'invalid',
    `A query cannot call ${reader}(): it reads tables by name or pattern, past what this connector shows. Name the tables in FROM.`,
  );
}

/**
 * Checks a SQL statement against what its connector shows.
 *
 * @param scope - The connector's scope.
 * @param text - The statement.
 * @param flavor - The connector's dialect; PostgreSQL when not given.
 * @throws {QueryError} `invalid` for a table the connector does not show, or a function that
 *   reads tables by name.
 */
export function checkSqlScope(scope: ObjectScope, text: string, flavor: SqlFlavor = 'postgres') {
  if (!restricts(scope)) return;
  const reads = sqlReads(sqlTokens(text, flavor));
  refuseReaders(scope, reads.calls);
  for (const parts of reads.tableFunctions) refuseSystem(scope, parts);
  // The same answer as the catalogue gives for the table's name, so it lists nothing refused here.
  for (const parts of reads.tables) requireShown(scope, parts.join('.'));
}
