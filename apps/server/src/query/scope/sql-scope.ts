/**
 * Checks the tables a SQL statement names against what its connector shows. It is best effort: it
 * reads the names after FROM, JOIN and TABLE and refuses the functions known to read a table by
 * name, but a view, another function or the search path can reach a table the text never names.
 * A database role that cannot read the table is the guarantee.
 */
import { matchesObjectName } from '@quanthea/shared';
import { QueryError } from '../query-error.ts';
import type { SqlFlavor } from '../sql-dialects.ts';
import {
  isSystemTable,
  notShown,
  type ObjectFamily,
  type ObjectScope,
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
 * The names a written table may go by: as written, and without PostgreSQL's default schema, which
 * the schema leaves out.
 *
 * @param family - The source's family.
 * @param parts - The table's parts.
 * @returns The names, the written one first.
 */
function namesOf(family: ObjectFamily, parts: readonly string[]): string[] {
  const written = parts.join('.');
  const inPublic = family === 'postgres' && parts.length === 2 && /^public$/i.test(parts[0] ?? '');
  return inPublic ? [written, parts[1] ?? ''] : [written];
}

/**
 * Every way a written table ends: `orders` for `shop.orders`. A hidden name hides the table in
 * every schema, since the text does not say which one a bare name reads.
 *
 * @param parts - The table's parts.
 * @returns The table's trailing names, the whole one first.
 */
function endingsOf(parts: readonly string[]): string[] {
  return parts.map((_part, index) => parts.slice(index).join('.'));
}

/**
 * Whether the connector's list lets a written table through. An `except` list hides a table when
 * a name covers it or any of its endings; an `only` list shows a table written as it is listed.
 *
 * @param scope - The connector's scope.
 * @param parts - The table's parts.
 * @returns `true` when the list does not hide the table.
 */
function listShowsTable(scope: ObjectScope, parts: readonly string[]): boolean {
  const { mode, names } = scope.visibility;
  const covered = (candidates: readonly string[]) =>
    candidates.some((candidate) => names.some((name) => matchesObjectName(name, candidate)));
  if (mode === 'only') return covered(namesOf(scope.family, parts));
  return !covered(endingsOf(parts));
}

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
  for (const parts of reads.tables) {
    refuseSystem(scope, parts);
    if (!listShowsTable(scope, parts)) throw notShown(parts.join('.'));
  }
}
