/**
 * Reads the shape of a SQLite file: its tables and views, each with its columns, their declared
 * types and a table's row count, and the distinct values of a column. Names come from the file's
 * own schema and are quoted, so a field the schema does not have is never queried.
 */
import type { Database } from 'bun:sqlite';
import type { SchemaEntity, SchemaSnapshot } from '@quanthea/plugin-kit';
import { typeOfDeclared } from './frames.ts';

/** A table or view, as `sqlite_schema` lists it. */
interface Entity {
  /** Its name. */
  readonly name: string;
  /** `table` or `view`. */
  readonly type: 'table' | 'view';
}

/** A column, as `pragma_table_info` lists it. */
interface Column {
  /** Its name. */
  readonly name: string;
  /** Its declared type. */
  readonly type: string;
}

/**
 * A quoted identifier.
 *
 * @param name - The name.
 * @returns Such as `"orders"`.
 */
export function quoted(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/**
 * The tables and views of a file, SQLite's own left out.
 *
 * @param database - The file.
 * @returns The entities, by name.
 */
function entitiesOf(database: Database): Entity[] {
  return database
    .query<Entity, []>(
      "SELECT name, type FROM sqlite_schema WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name",
    )
    .all();
}

/**
 * The columns of a table or view.
 *
 * @param database - The file.
 * @param entity - Its name.
 * @returns The columns, in order.
 */
export function columnsOf(database: Database, entity: string): Column[] {
  return database
    .query<Column, [string]>('SELECT name, type FROM pragma_table_info(?)')
    .all(entity);
}

/**
 * Reads the shape of a file.
 *
 * @param database - The file.
 * @returns The snapshot.
 */
export function describeFile(database: Database): SchemaSnapshot {
  const entities: SchemaEntity[] = entitiesOf(database).map((entity) => {
    const count =
      entity.type === 'table'
        ? database
            .query<{ n: number }, []>(`SELECT count(*) AS n FROM ${quoted(entity.name)}`)
            .get()?.n
        : undefined;
    return {
      name: entity.name,
      kind: entity.type,
      ...(count === undefined ? {} : { rowEstimate: count }),
      fields: columnsOf(database, entity.name).map((column) => {
        const type = typeOfDeclared(column.type);
        return { name: column.name, nativeType: column.type || 'any', ...(type ? { type } : {}) };
      }),
    };
  });
  return { entities };
}

/**
 * The distinct values of a column the schema has.
 *
 * @param database - The file.
 * @param entity - The table or view.
 * @param field - The column.
 * @param limit - How many values at most.
 * @returns The values, at most one more than the limit, or `undefined` for an unknown column.
 */
export function sampleColumn(
  database: Database,
  entity: string,
  field: string,
  limit: number,
): string[] | undefined {
  if (!columnsOf(database, entity).some((column) => column.name === field)) return undefined;
  const column = quoted(field);
  return database
    .query<{ value: unknown }, [number]>(
      `SELECT DISTINCT ${column} AS value FROM ${quoted(entity)} WHERE ${column} IS NOT NULL LIMIT ?`,
    )
    .all(limit + 1)
    .map((row) => String(row.value));
}
