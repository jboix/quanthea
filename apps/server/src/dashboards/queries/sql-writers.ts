/**
 * How the SQL builders write each dialect: names quoted, literals escaped, variables left as `:name`
 * references the binder fills in, and the few expressions that differ, such as time buckets.
 */
import type { SqlDialect, SqlFlavor } from '../../query/sql-dialects.ts';
import type { Filter } from './fields.ts';
import { QueryError, variableOf } from './text.ts';

/** What differs between dialects when a builder writes SQL. */
export interface SqlWriter {
  /**
   * Quotes one identifier. Names are checked against strict patterns before.
   *
   * @param identifier - A table, column or schema name.
   * @returns The quoted identifier.
   */
  quote(identifier: string): string;
  /**
   * A string literal.
   *
   * @param value - The value.
   * @returns The quoted, escaped value.
   */
  string(value: string): string;
  /**
   * An expression cast to text.
   *
   * @param expression - The expression.
   * @returns The cast.
   */
  text(expression: string): string;
  /**
   * A duration as an interval.
   *
   * @param duration - Such as `5m`, or a bound reference such as `:interval`.
   * @returns The interval.
   */
  interval(duration: DurationText): string;
  /**
   * The bucket a timestamp falls in.
   *
   * @param time - The quoted timestamp column.
   * @param duration - The bucket width.
   * @returns The start of the bucket.
   */
  bucket(time: string, duration: DurationText): string;
  /**
   * A regular expression match.
   *
   * @param column - The quoted column.
   * @param pattern - The pattern: a string literal or a bound reference.
   * @param negated - Whether the condition is that it does not match.
   * @returns The condition.
   */
  matches(column: string, pattern: string, negated: boolean): string;
  /**
   * A column alias in the select list.
   *
   * @param name - The alias, such as `value`.
   * @returns The alias as written.
   */
  alias(name: string): string;
  /**
   * The GROUP BY clause.
   *
   * @param keys - The grouped select items: their position and their expression.
   * @returns Such as `GROUP BY 1, 2`.
   */
  groupBy(keys: readonly GroupKey[]): string;
  /**
   * The clause that keeps at most some rows, after ORDER BY.
   *
   * @param rows - How many rows.
   * @returns Such as ` LIMIT 10`.
   */
  limit(rows: number): string;
}

/** A grouped select item. */
export interface GroupKey {
  /** Its position in the select list, from 1. */
  readonly position: number;
  /** The expression it groups on, such as a quoted column. */
  readonly expression: string;
}

/** How the built-in dialects write aliases, groups and limits: as they always have. */
const nativeClauses: Pick<SqlWriter, 'alias' | 'groupBy' | 'limit'> = {
  alias: (name) => name,
  groupBy: (keys) => `GROUP BY ${keys.map((key) => key.position).join(', ')}`,
  limit: (rows) => ` LIMIT ${rows}`,
};

/** A duration as the builders hold it: a literal, or a variable the binder fills in. */
export type DurationText =
  | { readonly literal: string; readonly seconds: number }
  | { readonly variable: string };

/** The seconds in each duration unit. */
const unitSeconds: Readonly<Record<string, number>> = { s: 1, m: 60, h: 3600, d: 86_400 };

/**
 * Reads a duration such as `5m` or `$interval`.
 *
 * @param duration - A duration checked by the request schema.
 * @returns The literal and its seconds, or the variable name.
 */
export function durationText(duration: string): DurationText {
  const variable = variableOf(duration);
  if (variable !== undefined) return { variable };
  const unit = duration.slice(-1);
  return { literal: duration, seconds: Number(duration.slice(0, -1)) * (unitSeconds[unit] ?? 1) };
}

/**
 * Seconds of a duration in MySQL: a number, or computed from the bound text such as `5m`.
 *
 * @param duration - The duration.
 * @returns The seconds expression.
 */
function mysqlSeconds(duration: DurationText): string {
  if ('seconds' in duration) return String(duration.seconds);
  const value = `:${duration.variable}`;
  return `(CAST(LEFT(${value}, CHAR_LENGTH(${value}) - 1) AS UNSIGNED) * ELT(FIELD(RIGHT(${value}, 1), 's', 'm', 'h', 'd'), 1, 60, 3600, 86400))`;
}

/**
 * A PostgreSQL interval.
 *
 * @param duration - The duration.
 * @returns Such as `'5m'::interval` or `:interval::interval`.
 */
function postgresInterval(duration: DurationText): string {
  return 'literal' in duration
    ? `'${duration.literal}'::interval`
    : `:${duration.variable}::interval`;
}

/** PostgreSQL: double-quoted names, `::` casts, `date_bin` from the start of the range. */
const postgresWriter: SqlWriter = {
  ...nativeClauses,
  quote: (identifier) => `"${identifier.replaceAll('"', '""')}"`,
  string: (value) => `'${value.replaceAll("'", "''")}'`,
  text: (expression) => `${expression}::text`,
  interval: postgresInterval,
  bucket: (time, duration) => `date_bin(${postgresInterval(duration)}, ${time}, :__from)`,
  matches: (column, pattern, negated) => `${column} ${negated ? '!~' : '~'} ${pattern}`,
};

/**
 * MySQL and MariaDB: backticked names, backslashes escaped in strings, buckets from epoch seconds.
 * The connector's session is in UTC, so the epoch arithmetic is too.
 */
const mysqlWriter: SqlWriter = {
  ...nativeClauses,
  quote: (identifier) => `\`${identifier.replaceAll('`', '``')}\``,
  string: (value) => `'${value.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`,
  text: (expression) => `CAST(${expression} AS CHAR)`,
  interval: (duration) => `INTERVAL ${mysqlSeconds(duration)} SECOND`,
  bucket: (time, duration) => {
    const seconds = mysqlSeconds(duration);
    return `FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(${time}) / ${seconds}) * ${seconds})`;
  },
  matches: (column, pattern, negated) =>
    `${column} ${negated ? 'NOT REGEXP' : 'REGEXP'} ${pattern}`,
};

/**
 * Seconds of a duration in ClickHouse: a number, or computed from the bound text such as `5m`.
 *
 * @param duration - The duration.
 * @returns The seconds expression.
 */
function clickhouseSeconds(duration: DurationText): string {
  if ('seconds' in duration) return String(duration.seconds);
  const value = `:${duration.variable}`;
  return `(toUInt32(substring(${value}, 1, length(${value}) - 1)) * transform(right(${value}, 1), ['s', 'm', 'h', 'd'], [1, 60, 3600, 86400], 0))`;
}

/**
 * ClickHouse: backticked names and strings with backslash escapes, `match` for regular
 * expressions, buckets from epoch seconds in UTC (`toStartOfInterval` takes no bound width).
 */
const clickhouseWriter: SqlWriter = {
  ...nativeClauses,
  quote: (identifier) => `\`${identifier.replaceAll('\\', '\\\\').replaceAll('`', '\\`')}\``,
  string: (value) => `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`,
  text: (expression) => `toString(${expression})`,
  interval: (duration) => `toIntervalSecond(${clickhouseSeconds(duration)})`,
  bucket: (time, duration) => {
    const seconds = clickhouseSeconds(duration);
    return `toDateTime(intDiv(toUnixTimestamp(${time}), ${seconds}) * ${seconds}, 'UTC')`;
  },
  matches: (column, pattern, negated) => `${negated ? 'NOT ' : ''}match(${column}, ${pattern})`,
};

/**
 * Seconds of a duration in Trino: a number, or computed from the bound text such as `5m`.
 *
 * @param duration - The duration.
 * @returns The seconds expression.
 */
function trinoSeconds(duration: DurationText): string {
  if ('seconds' in duration) return String(duration.seconds);
  return `(to_milliseconds(parse_duration(:${duration.variable})) / 1000)`;
}

/**
 * Trino: double-quoted names, standard strings, `regexp_like`, buckets from epoch seconds. The
 * connector's session is in UTC.
 */
const trinoWriter: SqlWriter = {
  ...nativeClauses,
  quote: (identifier) => `"${identifier.replaceAll('"', '""')}"`,
  string: (value) => `'${value.replaceAll("'", "''")}'`,
  text: (expression) => `CAST(${expression} AS varchar)`,
  interval: (duration) =>
    'seconds' in duration
      ? `INTERVAL '${duration.seconds}' SECOND`
      : `parse_duration(:${duration.variable})`,
  bucket: (time, duration) => {
    const seconds = trinoSeconds(duration);
    return `from_unixtime(floor(to_unixtime(${time}) / ${seconds}) * ${seconds})`;
  },
  matches: (column, pattern, negated) =>
    `${negated ? 'NOT ' : ''}regexp_like(${column}, ${pattern})`,
};

/**
 * Refuses an expression standard SQL has no portable form of.
 *
 * @param what - What is missing, for the message.
 * @returns Never.
 * @throws {QueryError} Always.
 */
function notStandard(what: string): never {
  throw new QueryError(
    `This connector speaks standard SQL, which has no portable ${what}: write a raw query.`,
  );
}

/**
 * Standard SQL, for the `ansi` dialect: double-quoted names and aliases, standard strings and
 * casts, groups by expression (SQL Server and Oracle refuse positions), and the kind's row limit.
 * Time buckets, intervals and regular expressions have no standard form, so the builders that
 * need them are refused.
 *
 * @param rowLimit - How the source limits rows.
 * @returns The writer.
 */
function ansiWriter(rowLimit: 'fetch' | 'limit'): SqlWriter {
  const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;
  return {
    quote,
    string: (value) => `'${value.replaceAll("'", "''")}'`,
    text: (expression) => `CAST(${expression} AS VARCHAR(1000))`,
    interval: () => notStandard('interval'),
    bucket: () => notStandard('time buckets'),
    matches: () => notStandard('regular expressions'),
    alias: quote,
    groupBy: (keys) => `GROUP BY ${keys.map((key) => key.expression).join(', ')}`,
    limit: (rows) => (rowLimit === 'fetch' ? ` FETCH FIRST ${rows} ROWS ONLY` : ` LIMIT ${rows}`),
  };
}

/** The writer of each built-in dialect. */
const writers: Readonly<Record<Exclude<SqlDialect, 'ansi'>, SqlWriter>> = {
  postgres: postgresWriter,
  mysql: mysqlWriter,
  clickhouse: clickhouseWriter,
  trino: trinoWriter,
  // DataFusion, under InfluxDB 3, takes PostgreSQL's date_bin, ::interval and ~.
  influxdb: postgresWriter,
};

/**
 * The writer of a dialect.
 *
 * @param flavor - The connector's dialect, with its styles for `ansi`; PostgreSQL when not known.
 * @returns The writer.
 */
export function sqlWriterFor(flavor: SqlFlavor | undefined): SqlWriter {
  if (typeof flavor === 'object') return ansiWriter(flavor.rowLimit);
  return writers[flavor ?? 'postgres'];
}

/**
 * The keys of a measure over time: the bucket as `time` and, when split, the column as `series`,
 * with the GROUP BY that groups on them.
 *
 * @param writer - The dialect's writer.
 * @param bucket - The bucket expression.
 * @param by - The column to split by, if any.
 * @returns The select items, without a trailing comma, and the GROUP BY clause.
 */
export function timeKeys(
  writer: SqlWriter,
  bucket: string,
  by: string | undefined,
): { readonly select: string; readonly group: string } {
  const keys: GroupKey[] = [{ position: 1, expression: bucket }];
  let select = `${bucket} AS ${writer.alias('time')}`;
  if (by !== undefined) {
    const series = writer.text(sqlName(writer, by));
    keys.push({ position: 2, expression: series });
    select += `, ${series} AS ${writer.alias('series')}`;
  }
  return { select, group: writer.groupBy(keys) };
}

/**
 * A quoted name, or a schema and a table.
 *
 * @param writer - The dialect's writer.
 * @param name - The name, checked by the request schema.
 * @returns Such as `"orders"` or `"shop"."orders"`.
 */
export function sqlName(writer: SqlWriter, name: string): string {
  return name
    .split('.')
    .map((part) => writer.quote(part))
    .join('.');
}

/**
 * A SQL condition. A variable is bound (`:name`); equality with a variable uses `IN`, so a
 * multi-value variable works.
 *
 * @param writer - The dialect's writer.
 * @param filter - The filter.
 * @returns Such as `"status" = 'failed'` or `"service" IN (:service)`.
 */
export function sqlCondition(writer: SqlWriter, filter: Filter): string {
  const variable = variableOf(filter.value);
  const column = sqlName(writer, filter.field);
  const value = variable === undefined ? writer.string(filter.value) : `:${variable}`;
  if (filter.op === '=~' || filter.op === '!~')
    return writer.matches(column, value, filter.op === '!~');
  if (variable === undefined) return `${column} ${filter.op === '=' ? '=' : '<>'} ${value}`;
  return `${column} ${filter.op === '=' ? 'IN' : 'NOT IN'} (${value})`;
}

/**
 * The WHERE clause of a SQL builder: the time range when a time column is given, and the filters.
 *
 * @param writer - The dialect's writer.
 * @param time - The timestamp column, if any.
 * @param filters - The filters.
 * @returns Such as ` WHERE "created_at" BETWEEN :__from AND :__to AND "status" = 'failed'`.
 */
export function sqlWhere(
  writer: SqlWriter,
  time: string | undefined,
  filters: readonly Filter[],
): string {
  const range = time === undefined ? [] : [`${sqlName(writer, time)} BETWEEN :__from AND :__to`];
  const conditions = [...range, ...filters.map((filter) => sqlCondition(writer, filter))];
  return conditions.length === 0 ? '' : ` WHERE ${conditions.join(' AND ')}`;
}
