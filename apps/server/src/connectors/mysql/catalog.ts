/** Reads the shape of a MySQL or MariaDB database from `information_schema`: tables, views, columns. */
import type { SchemaEntity, SchemaField } from '../_shared/index.ts';
import { fieldTypeOfName } from './columns.ts';

/** One column of the catalog query. */
export interface CatalogRow {
  /** The table or view name. */
  readonly table_name: string;
  /** `BASE TABLE`, `VIEW`, or `SYSTEM VERSIONED` on MariaDB. */
  readonly table_type: string;
  /** The table comment, empty when there is none. */
  readonly table_comment: string | null;
  /** The storage engine's row estimate. */
  readonly table_rows: number | null;
  /** The column name. */
  readonly column_name: string;
  /** The type name, such as `bigint`. */
  readonly data_type: string;
  /** The full type, such as `bigint unsigned` or `varchar(64)`. */
  readonly column_type: string;
  /** The column comment, empty when there is none. */
  readonly column_comment: string | null;
  /** The distinct values of the index that starts with the column, when there is one. */
  readonly cardinality: number | null;
}

/**
 * Tables, views and their columns in the connector's database, with comments, row estimates and,
 * for indexed columns, distinct-value estimates. It reads statistics, never table data.
 */
export const catalogQuery = `
SELECT t.TABLE_NAME AS table_name, t.TABLE_TYPE AS table_type, t.TABLE_COMMENT AS table_comment,
  t.TABLE_ROWS AS table_rows, c.COLUMN_NAME AS column_name, c.DATA_TYPE AS data_type,
  c.COLUMN_TYPE AS column_type, c.COLUMN_COMMENT AS column_comment,
  (SELECT MAX(s.CARDINALITY) FROM information_schema.STATISTICS s
    WHERE s.TABLE_SCHEMA = c.TABLE_SCHEMA AND s.TABLE_NAME = c.TABLE_NAME
      AND s.COLUMN_NAME = c.COLUMN_NAME AND s.SEQ_IN_INDEX = 1) AS cardinality
FROM information_schema.TABLES t
JOIN information_schema.COLUMNS c
  ON c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
WHERE t.TABLE_SCHEMA = DATABASE() AND t.TABLE_TYPE <> 'SEQUENCE'
ORDER BY t.TABLE_NAME, c.ORDINAL_POSITION`;

/**
 * Turns one catalog row into a schema field.
 *
 * @param row - The catalog row.
 * @returns The field.
 */
function toField(row: CatalogRow): SchemaField {
  return {
    name: row.column_name,
    nativeType: row.column_type,
    type: fieldTypeOfName(row.data_type),
    ...(row.column_comment ? { description: row.column_comment } : {}),
    ...(row.cardinality === null ? {} : { distinctEstimate: Number(row.cardinality) }),
  };
}

/**
 * Starts the entity of a table or view.
 *
 * @param row - Its first catalog row.
 * @returns The entity, without fields yet.
 */
function toEntity(row: CatalogRow): SchemaEntity & { fields: SchemaField[] } {
  return {
    name: row.table_name,
    kind: row.table_type === 'VIEW' ? 'view' : 'table',
    ...(row.table_comment ? { description: row.table_comment } : {}),
    ...(row.table_rows === null ? {} : { rowEstimate: Number(row.table_rows) }),
    fields: [],
  };
}

/**
 * Groups catalog rows into entities.
 *
 * @param rows - The catalog rows, ordered by table and column position.
 * @returns One entity per table or view.
 */
export function toEntities(rows: readonly CatalogRow[]): SchemaEntity[] {
  const entities = new Map<string, SchemaEntity & { fields: SchemaField[] }>();
  rows.forEach((row) => {
    const entity = entities.get(row.table_name) ?? toEntity(row);
    entity.fields.push(toField(row));
    entities.set(row.table_name, entity);
  });
  return [...entities.values()];
}

/**
 * Quotes an identifier for MySQL.
 *
 * @param identifier - A table or column name from the catalog.
 * @returns The identifier in backticks, inner backticks doubled.
 */
export function quoteIdentifier(identifier: string): string {
  return `\`${identifier.replaceAll('`', '``')}\``;
}
