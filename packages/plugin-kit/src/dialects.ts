/** The SQL dialects the core binds, and the styles an `ansi` source picks. */

/**
 * The SQL dialects the core knows how to bind: how each writes its literals and its placeholders.
 * A SQL connector kind declares one of them. `ansi` is standard SQL, for the sources the others do
 * not fit; its kind also picks a placeholder style and a row-limit style.
 */
export const sqlDialects = [
  'postgres',
  'mysql',
  'clickhouse',
  'trino',
  'influxdb',
  'ansi',
] as const;

/** A SQL dialect name. */
export type SqlDialect = (typeof sqlDialects)[number];

/**
 * How an `ansi` source writes a placeholder: `?` (JDBC, ODBC, SQLite, Snowflake), `$1` (numbered,
 * as PostgreSQL), `:1` (numbered, as Oracle) or `@p1` (named, as SQL Server drivers).
 */
export const sqlPlaceholderStyles = ['?', '$1', ':1', '@p1'] as const;

/** A placeholder style. */
export type SqlPlaceholderStyle = (typeof sqlPlaceholderStyles)[number];

/** How an `ansi` source limits rows: `FETCH FIRST n ROWS ONLY`, the standard, or `LIMIT n`. */
export const sqlRowLimits = ['fetch', 'limit'] as const;

/** A row-limit style. */
export type SqlRowLimit = (typeof sqlRowLimits)[number];
