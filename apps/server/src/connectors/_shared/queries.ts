/** The queries a connector executes: already bound, never a template with raw variables. */

/** The query languages the core knows how to bind. A connector kind declares one of them. */
export const queryLanguages = ['sql', 'promql'] as const;

/** A query language name. */
export type QueryLanguage = (typeof queryLanguages)[number];

/**
 * The SQL dialects the core knows how to bind: how each writes its literals and its placeholders.
 * A SQL connector kind declares one of them.
 */
export const sqlDialects = ['postgres', 'mysql'] as const;

/** A SQL dialect name. */
export type SqlDialect = (typeof sqlDialects)[number];

/** A value bound to a SQL placeholder. */
export type SqlParameter = string | number | boolean | Date | null;

/**
 * A SQL query with positional placeholders and their values. The placeholders are the dialect's:
 * `$1`, `$2`… for `postgres`, `?` for `mysql`. The core checked that it is a single read statement.
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

/** A query ready to execute. Connectors receive nothing else. */
export type BoundQuery = SqlQuery | PromqlQuery;

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
