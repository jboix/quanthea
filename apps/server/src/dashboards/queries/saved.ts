/**
 * Saved queries: an admin's query with typed placeholders. Each placeholder is checked for its
 * kind and written for the query's language, like the builders write theirs: names
 * checked and quoted, values escaped or bound, durations checked.
 */
import type { PanelQuery, QueryParamKind, SavedQuery } from '@querent/shared';
import type { BuildContext, BuiltData } from './built.ts';
import type { DataOf } from './request.ts';
import { durationText, type SqlWriter, sqlName, sqlWriterFor } from './sql-writers.ts';
import { metricName, QueryError, variableOf } from './text.ts';

/** A plain label or column name. */
const plainName = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** A table, or a schema and a table. */
const tableName = /^[A-Za-z_]\w*(\.[A-Za-z_]\w*)?$/;

/** A duration, or an interval variable. */
const duration = /^(\d{1,5}[smhd]|\$[A-Za-z_]\w*)$/;

/**
 * Checks a value against a pattern.
 *
 * @param value - The value.
 * @param pattern - The pattern.
 * @param what - What the value should be, for the error.
 * @returns The value.
 * @throws {QueryError} When it does not match.
 */
function checked(value: string, pattern: RegExp, what: string): string {
  if (!pattern.test(value)) throw new QueryError(`"${value}" is not ${what}.`);
  return value;
}

/**
 * A value in a query: a bound variable, or an escaped literal.
 *
 * @param value - Such as `checkout-svc` or `$service`.
 * @param sql - The SQL writer, or `undefined` for PromQL.
 * @returns Such as `"checkout-svc"` in PromQL or `:service` in SQL.
 */
function valueText(value: string, sql: SqlWriter | undefined): string {
  const variable = variableOf(value);
  if (!sql) return variable ? `"${value}"` : JSON.stringify(value);
  return variable ? `:${variable}` : sql.string(value);
}

/** How each kind of placeholder is written: in SQL with the dialect's writer, or in PromQL. */
const writers: Readonly<
  Record<QueryParamKind, (value: string, sql: SqlWriter | undefined) => string>
> = {
  value: valueText,
  duration: (value, sql) => {
    const checkedDuration = checked(value, duration, 'a duration such as 5m');
    return sql ? sql.interval(durationText(checkedDuration)) : checkedDuration;
  },
  metric: (value, sql) => {
    if (sql) throw new QueryError('A SQL query has no metrics.');
    return metricName(value);
  },
  table: (value, sql) => {
    if (!sql) throw new QueryError('A PromQL query has no tables.');
    return sqlName(sql, checked(value, tableName, 'a table name'));
  },
  label: (value, sql) => {
    const name = checked(value, plainName, 'a plain name');
    return sql ? sqlName(sql, name) : name;
  },
  column: (value, sql) => {
    const name = checked(value, plainName, 'a plain name');
    return sql ? sqlName(sql, name) : name;
  },
};

/**
 * The text a placeholder becomes.
 *
 * @param kind - The placeholder's kind.
 * @param sql - The SQL writer, or `undefined` for PromQL.
 * @param value - The value the agent gave.
 * @returns The text.
 * @throws {QueryError} When the value does not fit its kind or its language.
 */
function paramText(kind: QueryParamKind, sql: SqlWriter | undefined, value: string): string {
  return writers[kind](value, sql);
}

/**
 * A saved query's text with its placeholders filled.
 *
 * @param template - The saved query.
 * @param params - The values by placeholder.
 * @param sql - The SQL writer of the connector, or `undefined` for PromQL.
 * @returns The query text.
 * @throws {QueryError} When a placeholder has no value or a value does not fit.
 */
function filled(
  template: SavedQuery,
  params: Readonly<Record<string, string>>,
  sql: SqlWriter | undefined,
): string {
  return template.query.replace(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g, (_match, name: string) => {
    const param = template.params.find((each) => each.name === name);
    const value = params[name];
    if (!param || value === undefined)
      throw new QueryError(`${template.name} needs a value for ${name}.`);
    return paramText(param.kind, sql, value);
  });
}

/** A chart that suits each shape, for previews and as a hint. */
const chartsByShape: Readonly<Record<SavedQuery['shape'], string>> = {
  long: 'trend.line',
  wide: 'trend.line',
  single: 'kpi.stat',
  values: 'distribution.histogram',
  matrix: 'relationship.heatmap',
  hierarchical: 'composition.treemap',
  graph: 'flow.sankey',
  geo: 'geo.choropleth',
  ohlc: 'trend.candlestick',
  rows: 'table.rows',
};

/**
 * Builds a saved query.
 *
 * @param request - The request: the query's id, its connector and its values.
 * @param context - The saved queries the run may use, and each connector's dialect.
 * @returns The query and its output.
 * @throws {QueryError} For an unknown query or values that do not fit.
 */
export function savedData(request: DataOf<'saved'>, context: BuildContext): BuiltData {
  const template = context.saved.find((each) => each.id === request.name);
  if (!template) throw new QueryError(`No saved query "${request.name}".`);
  const sql =
    template.language === 'sql' ? sqlWriterFor(context.dialectOf?.(request.connector)) : undefined;
  const text = filled(template, request.params, sql);
  const query: PanelQuery =
    template.language === 'sql'
      ? { refId: 'A', connector: request.connector, language: 'sql', sql: text }
      : { refId: 'A', connector: request.connector, language: 'promql', expr: text };
  return {
    queries: [query],
    output: { shape: template.shape, columns: [], chart: chartsByShape[template.shape] },
  };
}
