/** Reads the shape of a Postgres database from its catalog: tables, views, columns, estimates. */
import type { SchemaEntity, SchemaField } from '../_shared/index.ts';

/** One column of the catalog query. */
export interface CatalogRow {
  /** The schema name. */
  readonly schema: string;
  /** The table or view name. */
  readonly table: string;
  /** `r` table, `v` view, `m` materialized view, `p` partitioned table. */
  readonly relkind: string;
  /** The table comment. */
  readonly table_comment: string | null;
  /** The planner's row estimate; -1 when never analyzed. */
  readonly row_estimate: number;
  /** The column name. */
  readonly column: string;
  /** The column type, as `format_type` prints it. */
  readonly data_type: string;
  /** The column type OID. */
  readonly type_oid: number;
  /** The column comment. */
  readonly column_comment: string | null;
  /** `pg_stats.n_distinct`: a count when positive, a fraction of the rows when negative. */
  readonly n_distinct: number | null;
}

/**
 * Tables, views and their columns in every schema but the system ones and TimescaleDB's own (its
 * chunks, catalog and information views), with comments, row estimates and distinct-value
 * estimates. It reads statistics, never table data.
 */
export const catalogQuery = `
SELECT n.nspname AS schema, c.relname AS "table", c.relkind::text AS relkind,
  obj_description(c.oid, 'pg_class') AS table_comment, c.reltuples::float8 AS row_estimate,
  a.attname AS "column", format_type(a.atttypid, a.atttypmod) AS data_type,
  a.atttypid::int AS type_oid, col_description(c.oid, a.attnum) AS column_comment,
  s.n_distinct::float8 AS n_distinct
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
LEFT JOIN pg_stats s ON s.schemaname = n.nspname AND s.tablename = c.relname AND s.attname = a.attname
WHERE c.relkind IN ('r', 'v', 'm', 'p')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%'
  AND n.nspname NOT LIKE '\\_timescaledb%' ESCAPE '\\' AND n.nspname NOT LIKE 'timescaledb\\_%' ESCAPE '\\'
  AND has_table_privilege(c.oid, 'SELECT')
ORDER BY n.nspname, c.relname, a.attnum`;

/**
 * The name queries use for a table: bare in `public`, qualified elsewhere.
 *
 * @param schema - The schema name.
 * @param table - The table name.
 * @returns `orders` or `analytics.events`.
 */
export function entityName(schema: string, table: string): string {
  return schema === 'public' ? table : `${schema}.${table}`;
}

/**
 * Turns `n_distinct` into a count.
 *
 * @param row - The catalog row.
 * @returns The estimated number of distinct values, or `undefined` without statistics.
 */
function distinctEstimate(row: CatalogRow): number | undefined {
  if (row.n_distinct === null) return undefined;
  if (row.n_distinct >= 0) return row.n_distinct;
  return Math.round(-row.n_distinct * Math.max(row.row_estimate, 0));
}

/**
 * Turns one catalog row into a schema field.
 *
 * @param row - The catalog row.
 * @param fieldType - The frame type of the column type.
 * @returns The field.
 */
function toField(row: CatalogRow, fieldType: SchemaField['type']): SchemaField {
  const estimate = distinctEstimate(row);
  return {
    name: row.column,
    nativeType: row.data_type,
    ...(fieldType === undefined ? {} : { type: fieldType }),
    ...(row.column_comment === null ? {} : { description: row.column_comment }),
    ...(estimate === undefined ? {} : { distinctEstimate: estimate }),
  };
}

/**
 * Groups catalog rows into entities.
 *
 * @param rows - The catalog rows, ordered by schema, table and column position.
 * @param typeOf - Maps a type OID to a frame type.
 * @returns One entity per table or view.
 */
export function toEntities(
  rows: readonly CatalogRow[],
  typeOf: (oid: number) => SchemaField['type'],
): SchemaEntity[] {
  const entities = new Map<string, SchemaEntity & { fields: SchemaField[] }>();
  rows.forEach((row) => {
    const name = entityName(row.schema, row.table);
    const entity = entities.get(name) ?? {
      name,
      kind: row.relkind === 'v' || row.relkind === 'm' ? ('view' as const) : ('table' as const),
      ...(row.table_comment === null ? {} : { description: row.table_comment }),
      ...(row.row_estimate >= 0 ? { rowEstimate: Math.round(row.row_estimate) } : {}),
      fields: [],
    };
    entity.fields.push(toField(row, typeOf(row.type_oid)));
    entities.set(name, entity);
  });
  return [...entities.values()];
}

/**
 * Quotes an identifier for SQL.
 *
 * @param identifier - A schema, table or column name from the catalog.
 * @returns The identifier in double quotes, inner quotes doubled.
 */
export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}
