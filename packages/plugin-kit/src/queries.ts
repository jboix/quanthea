/** The queries a connector executes: already bound, never a template with raw variables. */
import type { QueryLanguage } from './languages.ts';

export type { QueryLanguage };

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

/** A value bound to a SQL placeholder. */
export type SqlParameter = string | number | boolean | Date | null;

/**
 * A SQL query with positional placeholders and their values. The placeholders are the dialect's:
 * `$1`, `$2`… for `postgres`, `?` for `mysql` and `trino`, `{p1:Type}`, `{p2:Type}`… for
 * `clickhouse`, `$p1`, `$p2`… for `influxdb`, and the kind's placeholder style for `ansi`, where `pN`
 * is the Nth value. The core checked that it is a single read statement.
 */
export interface SqlQuery {
  /** The query language. */
  readonly language: 'sql';
  /** The statement, with the dialect's placeholders. */
  readonly text: string;
  /** The placeholder values, in order. */
  readonly parameters: readonly SqlParameter[];
}

/** A PromQL expression with every variable already substituted and escaped. */
export interface PromqlQuery {
  /** The query language. */
  readonly language: 'promql';
  /** The expression. */
  readonly expr: string;
  /** `true` evaluates once at the end of the time range; `false` over the range. */
  readonly instant: boolean;
  /** Seconds between points of a range query. */
  readonly stepSeconds: number;
}

/**
 * A search request in the Elasticsearch and OpenSearch query DSL, every variable already put in
 * as a JSON value. The core checked that the body holds no script.
 */
export interface SearchQuery {
  /** The query language. */
  readonly language: 'search';
  /** The index, index pattern or comma-separated list of them. */
  readonly index: string;
  /** The search body: `query`, `aggs`, `sort`, `size` and the like. */
  readonly body: Readonly<Record<string, unknown>>;
}

/** A LogQL expression with every variable already substituted and escaped. */
export interface LogqlQuery {
  /** The query language. */
  readonly language: 'logql';
  /** The expression: a log query or a metric query. */
  readonly expr: string;
  /** `true` evaluates once at the end of the time range; `false` over the range. */
  readonly instant: boolean;
  /** Seconds between points of a metric range query. */
  readonly stepSeconds: number;
}

/** How a column of an HTTP response is read. */
export interface HttpField {
  /** The column name. */
  readonly name: string;
  /** Where the value is in each row, as a JSON pointer from the row. */
  readonly pointer: string;
  /** The column type; inferred from the values when absent. */
  readonly type?: 'time' | 'number' | 'string' | 'boolean' | undefined;
  /** For a time given as a number: seconds or milliseconds since the epoch. */
  readonly unit?: 's' | 'ms' | undefined;
}

/**
 * An HTTP request with every variable already put in: the path encoded, each query parameter a
 * separate value, the body's variables JSON values. The connector checks the method and the path
 * against what its settings allow.
 */
export interface HttpQuery {
  /** The query language. */
  readonly language: 'http';
  /** `GET` or `POST`. */
  readonly method: 'GET' | 'POST';
  /** The path under the connector's base URL, encoded, without a query string. */
  readonly path: string;
  /** The query parameters, in order; a name may repeat. */
  readonly query: readonly (readonly [string, string])[];
  /** The JSON body of a POST. */
  readonly body?: Readonly<Record<string, unknown>> | undefined;
  /** How the response becomes a table. */
  readonly extract: {
    /** The array of rows, as a JSON pointer. */
    readonly rows: string;
    /** The columns, or none to take every value of the rows. */
    readonly fields?: readonly HttpField[] | undefined;
  };
}

/** A Redis or Valkey read command, with every variable put in. The core checked it only reads. */
export interface RedisQuery {
  /** The query language. */
  readonly language: 'redis';
  /** The command, upper case. */
  readonly command: string;
  /** Its arguments, each sent as one argument whatever it holds. */
  readonly args: readonly string[];
}

/**
 * A MongoDB aggregation over one collection, every variable already put in as a JSON value. The
 * stages are Extended JSON (`{"$date": …}` for a date), and the core checked that none writes or
 * runs JavaScript.
 */
export interface MongodbQuery {
  /** The query language. */
  readonly language: 'mongodb';
  /** The collection the pipeline starts from. */
  readonly collection: string;
  /** The stages, each an object with one `$` key. */
  readonly pipeline: readonly Readonly<Record<string, unknown>>[];
}

/** A query ready to execute. Connectors receive nothing else. */
export type BoundQuery =
  | SqlQuery
  | PromqlQuery
  | SearchQuery
  | LogqlQuery
  | HttpQuery
  | RedisQuery
  | MongodbQuery;

/** The time range a query covers. */
export interface TimeRange {
  /** The start, inclusive. */
  readonly from: Date;
  /** The end, inclusive. */
  readonly to: Date;
}

/** What the core asks of one execution. Connectors must respect every field. */
export interface ExecutionContext {
  /** The name of the frames this query returns. */
  readonly refId: string;
  /** Aborted on timeout or when the caller gives up. Stop work and reject when it fires. */
  readonly signal: AbortSignal;
  /** The query timeout, for sources that enforce one themselves (a statement timeout). */
  readonly timeoutMs: number;
  /** Rows (or points) to return at most, per frame. Mark the frame truncated when there are more. */
  readonly maxRows: number;
  /** The time range of the query. */
  readonly timeRange: TimeRange;
}
