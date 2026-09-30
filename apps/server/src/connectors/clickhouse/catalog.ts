/** Reads the shape of a ClickHouse database from `system.tables` and `system.columns`. */
import type { SchemaEntity, SchemaField } from '../_shared/index.ts';
import { fieldTypeOf } from './columns.ts';

/** One row of the catalog query. */
export interface CatalogRow {
  /** The table or view name. */
  readonly table_name: string;
  /** The table engine, such as `MergeTree` or `View`. */
  readonly engine: string;
  /** The table comment, empty when there is none. */
  readonly table_comment: string;
  /** The row count the engine keeps, `null` when it keeps none. */
  readonly total_rows: number | null;
  /** The column name. */
  readonly column_name: string;
  /** The column type, such as `LowCardinality(String)`. */
  readonly column_type: string;
  /** The column comment, empty when there is none. */
  readonly column_comment: string;
}

/**
 * Tables, views and their columns in the connector's database, with comments and the row counts
 * engines keep. It reads the system tables, never table data.
 */
export const catalogQuery = `
SELECT t.name AS table_name, t.engine AS engine, t.comment AS table_comment,
  t.total_rows AS total_rows, c.name AS column_name, c.type AS column_type,
  c.comment AS column_comment
FROM system.tables AS t
INNER JOIN system.columns AS c ON c.database = t.database AND c.table = t.name
WHERE t.database = currentDatabase() AND NOT t.is_temporary
ORDER BY t.name, c.position`;

/** Engines of views, whose rows a query computes. */
const viewEngines = new Set(['View', 'MaterializedView', 'LiveView', 'WindowView']);

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
    type: fieldTypeOf(row.column_type),
    ...(row.column_comment ? { description: row.column_comment } : {}),
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
    kind: viewEngines.has(row.engine) ? 'view' : 'table',
    ...(row.table_comment ? { description: row.table_comment } : {}),
    ...(row.total_rows === null ? {} : { rowEstimate: Number(row.total_rows) }),
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
  for (const row of rows) {
    const entity = entities.get(row.table_name) ?? toEntity(row);
    entity.fields.push(toField(row));
    entities.set(row.table_name, entity);
  }
  return [...entities.values()];
}

/**
 * Quotes an identifier for ClickHouse.
 *
 * @param identifier - A table or column name from the catalog.
 * @returns The identifier in backticks, with backslashes and backticks escaped.
 */
export function quoteIdentifier(identifier: string): string {
  return `\`${identifier.replaceAll('\\', '\\\\').replaceAll('`', '\\`')}\``;
}
