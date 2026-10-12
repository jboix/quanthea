/**
 * Which objects of a source a connector shows: its indices, tables, collections, metrics or
 * endpoints. The source's own objects are hidden unless the connector shows them, and the admin's
 * list hides names or shows nothing else. The catalog and every query read this one answer.
 */
import { listShowsObject, type ObjectVisibility } from '@quanthea/shared';
import type { QueryLanguage } from '../../connectors/_shared/index.ts';
import { QueryError } from '../query-error.ts';
import type { SqlFlavor } from '../sql-dialects.ts';

/** How a source names its own objects: by query language, and by dialect for SQL. */
export type ObjectFamily =
  | 'search'
  | 'mongodb'
  | 'postgres'
  | 'mysql'
  | 'clickhouse'
  | 'trino'
  | 'influxdb'
  | 'sql'
  | 'plain';

/** What a connector shows, and how its source names its own objects. */
export interface ObjectScope {
  /** The connector's setting. */
  readonly visibility: ObjectVisibility;
  /** The naming rules of its source. */
  readonly family: ObjectFamily;
}

/** The start of the names a search server keeps for itself: hidden, security, audit, insights. */
const searchSystemPrefixes = ['.', 'security-auditlog-', 'top_queries-', 'ilm-history-'];

/** The schemas, databases or catalogs each SQL source keeps for itself, in lower case. */
const systemSchemas: Readonly<Partial<Record<ObjectFamily, readonly string[]>>> = {
  postgres: ['information_schema', 'pg_catalog'],
  mysql: ['information_schema', 'performance_schema', 'mysql', 'sys'],
  clickhouse: ['system', 'information_schema'],
  trino: ['information_schema', 'system'],
  influxdb: ['information_schema', 'system'],
  sql: ['information_schema'],
};

/** The start of the other schemas PostgreSQL and TimescaleDB keep for themselves. */
const postgresSchemaPrefixes = ['pg_', '_timescaledb', 'timescaledb_'];

/**
 * The family of a connector kind.
 *
 * @param language - The kind's query language.
 * @param dialect - Its SQL flavor, when it runs SQL.
 * @returns The family.
 */
function familyOf(language: QueryLanguage, dialect?: SqlFlavor): ObjectFamily {
  if (language === 'search' || language === 'mongodb') return language;
  if (language !== 'sql') return 'plain';
  return typeof dialect === 'string' ? dialect : 'sql';
}

/**
 * Whether a PostgreSQL name is the server's own: in one of its schemas, or a bare `pg_` name,
 * which resolves in `pg_catalog` whatever the search path.
 *
 * @param segments - The name's parts, in lower case.
 * @returns `true` for a system name.
 */
function postgresOwn(segments: readonly string[]): boolean {
  const owned = (part: string) => postgresSchemaPrefixes.some((prefix) => part.startsWith(prefix));
  if (segments.length === 1) return (segments[0] ?? '').startsWith('pg_');
  return segments.slice(0, -1).some(owned);
}

/**
 * Whether a SQL name is one of its source's own: a table in a system schema, database or catalog.
 *
 * @param family - The source's family.
 * @param segments - The name's parts, as `schema`, `table`.
 * @returns `true` for a system name.
 */
export function isSystemTable(family: ObjectFamily, segments: readonly string[]): boolean {
  const lower = segments.map((part) => part.toLowerCase());
  const schemas = systemSchemas[family] ?? [];
  if (lower.slice(0, -1).some((part) => schemas.includes(part))) return true;
  return family === 'postgres' && postgresOwn(lower);
}

/**
 * Whether a name is one of its source's own objects: a dot index or a security, audit or
 * query-insight index of a search server, a table of a system schema, a MongoDB `system.`
 * collection.
 *
 * @param family - The source's family.
 * @param name - The name, as the schema lists it or a query writes it.
 * @returns `true` for a system object.
 */
export function isSystemObject(family: ObjectFamily, name: string): boolean {
  const lower = name.toLowerCase();
  if (family === 'search') return searchSystemPrefixes.some((prefix) => lower.startsWith(prefix));
  if (family === 'mongodb') return lower.startsWith('system.');
  if (family === 'plain') return false;
  return isSystemTable(family, lower.split('.'));
}

/**
 * Whether a connector hides anything at all.
 *
 * @param scope - The connector's scope.
 * @returns `false` when every object is shown, the source's own included where it has any.
 */
export function restricts(scope: ObjectScope): boolean {
  const { showSystem, mode, names } = scope.visibility;
  const hidesSystem = !showSystem && scope.family !== 'plain';
  return hidesSystem || mode === 'only' || names.length > 0;
}

/**
 * Whether a connector shows an object.
 *
 * @param scope - The connector's scope.
 * @param name - The object's name, as the schema lists it.
 * @returns `true` when the model may list it and queries may read it.
 */
export function showsObject(scope: ObjectScope, name: string): boolean {
  if (!scope.visibility.showSystem && isSystemObject(scope.family, name)) return false;
  return listShowsObject(scope.visibility, name);
}

/** A scope that shows everything, for a source nothing was chosen for. */
export const everythingShown: ObjectScope = {
  visibility: { showSystem: true, mode: 'except', names: [] },
  family: 'plain',
};

/**
 * The scope of a connector.
 *
 * @param visibility - The connector's setting.
 * @param language - Its kind's query language.
 * @param dialect - Its kind's SQL flavor, when it runs SQL.
 * @returns The scope.
 */
export function scopeOf(
  visibility: ObjectVisibility,
  language: QueryLanguage,
  dialect?: SqlFlavor,
): ObjectScope {
  return { visibility, family: familyOf(language, dialect) };
}

/**
 * The error for a query on an object its connector does not show.
 *
 * @param name - The object's name, as the query wrote it.
 * @returns The error.
 */
export function notShown(name: string): QueryError {
  return new QueryError(
    'invalid',
    `This connector does not show "${name}". Use an object its schema lists, named as it is there.`,
  );
}

/**
 * Refuses an object its connector does not show.
 *
 * @param scope - The connector's scope.
 * @param name - The object's name.
 * @throws {QueryError} `invalid` when the object is hidden.
 */
export function requireShown(scope: ObjectScope, name: string): void {
  if (!showsObject(scope, name)) throw notShown(name);
}
