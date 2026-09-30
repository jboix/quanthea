/**
 * Reads the shape of a Trino schema from `information_schema` and the table comments from
 * `system.metadata`.
 */
import type { SchemaEntity, SchemaField } from '../_shared/index.ts';
import { fieldTypeOf } from './columns.ts';

/** One row of the columns query. */
export interface ColumnRow {
  /** The table or view name. */
  readonly table_name: string;
  /** `BASE TABLE` or `VIEW`. */
  readonly table_type: string;
  /** The column name. */
  readonly column_name: string;
  /** The column type, such as `varchar(16)`. */
  readonly data_type: string;
}

/** The tables, views and columns of the connector's schema. It reads no table data. */
export const columnsQuery = `
SELECT c.table_name, t.table_type, c.column_name, c.data_type
FROM information_schema.columns AS c
JOIN information_schema.tables AS t
  ON t.table_schema = c.table_schema AND t.table_name = c.table_name
WHERE c.table_schema = current_schema
ORDER BY c.table_name, c.ordinal_position`;

/** The table comments of the connector's schema, which some catalogs keep. */
export const commentsQuery = `
SELECT table_name, comment FROM system.metadata.table_comments
WHERE catalog_name = current_catalog AND schema_name = current_schema AND comment IS NOT NULL`;

/**
 * Turns one row into a schema field.
 *
 * @param row - The columns row.
 * @returns The field.
 */
function toField(row: ColumnRow): SchemaField {
  return { name: row.column_name, nativeType: row.data_type, type: fieldTypeOf(row.data_type) };
}

/**
 * Groups column rows into entities, with their comments.
 *
 * @param rows - The column rows, ordered by table and column position.
 * @param comments - The table comments, by table name.
 * @returns One entity per table or view.
 */
export function toEntities(
  rows: readonly ColumnRow[],
  comments: ReadonlyMap<string, string>,
): SchemaEntity[] {
  const entities = new Map<string, SchemaEntity & { fields: SchemaField[] }>();
  for (const row of rows) {
    const description = comments.get(row.table_name);
    const entity = entities.get(row.table_name) ?? {
      name: row.table_name,
      kind: row.table_type === 'VIEW' ? 'view' : 'table',
      ...(description ? { description } : {}),
      fields: [],
    };
    entity.fields.push(toField(row));
    entities.set(row.table_name, entity);
  }
  return [...entities.values()];
}

/**
 * Quotes an identifier for Trino.
 *
 * @param identifier - A table or column name from the catalog.
 * @returns The identifier in double quotes, inner quotes doubled.
 */
export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}
