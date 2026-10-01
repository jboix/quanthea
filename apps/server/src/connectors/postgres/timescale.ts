/**
 * What TimescaleDB adds to the catalog of a Postgres database: hypertables, named by their time
 * column with the row count TimescaleDB estimates over their chunks, and continuous aggregates,
 * named by the hypertable they summarise. A database without the extension is left as it is.
 */
import type { SchemaEntity } from '../_shared/index.ts';
import { entityName } from './catalog.ts';

/** Whether the database has TimescaleDB. */
export const extensionQuery =
  "SELECT extversion AS version FROM pg_extension WHERE extname = 'timescaledb'";

/**
 * The hypertables and continuous aggregates, with what describes each. `approximate_row_count`
 * reads chunk statistics, never table data.
 */
export const timescaleQuery = `
SELECT h.hypertable_schema AS schema, h.hypertable_name AS "table", 'hypertable' AS kind,
  d.column_name AS detail,
  approximate_row_count(format('%I.%I', h.hypertable_schema, h.hypertable_name)::regclass)::float8
    AS row_estimate
FROM timescaledb_information.hypertables h
LEFT JOIN timescaledb_information.dimensions d
  ON d.hypertable_schema = h.hypertable_schema AND d.hypertable_name = h.hypertable_name
  AND d.dimension_number = 1
UNION ALL
SELECT c.view_schema, c.view_name, 'continuous aggregate',
  format('%s.%s', c.hypertable_schema, c.hypertable_name), NULL
FROM timescaledb_information.continuous_aggregates c`;

/** One row of {@link timescaleQuery}. */
export interface TimescaleRow {
  /** The schema. */
  readonly schema: string;
  /** The hypertable or the continuous aggregate. */
  readonly table: string;
  /** `hypertable` or `continuous aggregate`. */
  readonly kind: string;
  /** The time column of a hypertable, or the hypertable a continuous aggregate summarises. */
  readonly detail: string | null;
  /** The estimated rows of a hypertable. */
  readonly row_estimate: number | null;
}

/**
 * The sentence that says what TimescaleDB makes of an entity.
 *
 * @param row - The TimescaleDB row.
 * @returns Such as `TimescaleDB hypertable on created_at.`
 */
function sentenceOf(row: TimescaleRow): string {
  if (row.kind === 'hypertable')
    return `TimescaleDB hypertable on ${row.detail ?? 'its time column'}.`;
  const source = row.detail?.replace(/^public\./, '') ?? 'a hypertable';
  return `TimescaleDB continuous aggregate of ${source}.`;
}

/**
 * Adds what TimescaleDB says to the entities it concerns: a sentence after the comment, and the
 * row estimate of a hypertable, whose own estimate counts no chunk.
 *
 * @param entities - The entities from the catalog.
 * @param rows - The TimescaleDB rows.
 * @returns The entities.
 */
export function withTimescale(
  entities: readonly SchemaEntity[],
  rows: readonly TimescaleRow[],
): SchemaEntity[] {
  const byName = new Map(rows.map((row) => [entityName(row.schema, row.table), row]));
  return entities.map((entity) => {
    const row = byName.get(entity.name);
    if (!row) return entity;
    const description = [entity.description, sentenceOf(row)].filter(Boolean).join(' ');
    const estimate = row.row_estimate === null ? {} : { rowEstimate: Math.round(row.row_estimate) };
    return { ...entity, description, ...estimate };
  });
}
