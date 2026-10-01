/**
 * Saved queries: an admin's query with typed placeholders, in any language. Each placeholder is
 * checked for its kind and written for the query's language, like the builders write theirs:
 * names checked and quoted, values escaped or bound, durations checked. SQL, PromQL and LogQL are
 * text; a Redis command is filled word by word; the other languages are JSON (`saved-json.ts`).
 */
import type { PanelQuery, QueryParamKind, SavedQuery } from '@quanthea/shared';
import type { BuildContext, BuiltData } from './built.ts';
import { redisWords, templateQuery } from './raw.ts';
import type { DataOf } from './request.ts';
import { filledJson } from './saved-json.ts';
import { durationText, type SqlWriter, sqlName, sqlWriterFor } from './sql-writers.ts';
import { metricName, QueryError, variableOf } from './text.ts';

/** A plain label or column name. */
const plainName = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** A table, or a schema and a table. */
const tableName = /^[A-Za-z_]\w*(\.[A-Za-z_]\w*)?$/;

/** A duration, or an interval variable. */
const duration = /^(\d{1,5}[smhd]|\$[A-Za-z_]\w*)$/;

/** A Redis key or field name: no space, no `$`. */
const redisName = /^[^\s$]{1,200}$/;

/** A placeholder anywhere in the text. */
const placeholder = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g;

/** How each kind of placeholder is written in one language. */
type Writers = Readonly<Record<QueryParamKind, (value: string) => string>>;

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
 * A writer that refuses its kind in a language.
 *
 * @param message - Why.
 * @returns The writer.
 */
function refused(message: string): (value: string) => string {
  return () => {
    throw new QueryError(message);
  };
}

/**
 * The writers of SQL, in a dialect: names quoted, values bound or escaped.
 *
 * @param sql - The dialect's writer.
 * @returns The writers.
 */
function sqlWriters(sql: SqlWriter): Writers {
  const name = (value: string) => sqlName(sql, checked(value, plainName, 'a plain name'));
  return {
    value: (value) => {
      const variable = variableOf(value);
      return variable ? `:${variable}` : sql.string(value);
    },
    duration: (value) =>
      sql.interval(durationText(checked(value, duration, 'a duration such as 5m'))),
    metric: refused('A SQL query has no metrics.'),
    table: (value) => sqlName(sql, checked(value, tableName, 'a table name')),
    label: name,
    column: name,
  };
}

/** The writers of PromQL: values quoted, variables left for the binder. */
const promqlWriters: Writers = {
  value: (value) => (variableOf(value) ? `"${value}"` : JSON.stringify(value)),
  duration: (value) => checked(value, duration, 'a duration such as 5m'),
  metric: metricName,
  table: refused('A PromQL query has no tables.'),
  label: (value) => checked(value, plainName, 'a plain name'),
  column: (value) => checked(value, plainName, 'a plain name'),
};

/** The writers of LogQL: as PromQL, without metrics. */
const logqlWriters: Writers = {
  ...promqlWriters,
  metric: refused('A LogQL query has no metrics; select streams by label.'),
  table: refused('A LogQL query has no tables.'),
};

/** The writers of a Redis argument: a variable stays `$name`, which the binder fills. */
const redisWriters: Writers = {
  value: (value) => {
    if (variableOf(value)) return value;
    if (value.includes('$')) throw new QueryError(`"${value}" holds a $; use a variable instead.`);
    return value;
  },
  duration: (value) => checked(value, duration, 'a duration such as 5m'),
  metric: refused('A Redis command has no metrics.'),
  table: (value) => checked(value, redisName, 'a key'),
  label: (value) => checked(value, redisName, 'a key or field'),
  column: (value) => checked(value, redisName, 'a key or field'),
};

/**
 * A text with its placeholders filled.
 *
 * @param template - The saved query.
 * @param text - The text, the query or one of its words.
 * @param params - The values by placeholder.
 * @param writers - How the language writes each kind.
 * @returns The text.
 * @throws {QueryError} When a placeholder has no value or a value does not fit.
 */
function filled(
  template: SavedQuery,
  text: string,
  params: Readonly<Record<string, string>>,
  writers: Writers,
): string {
  return text.replace(placeholder, (_match, name: string) => {
    const param = template.params.find((each) => each.name === name);
    const value = params[name];
    if (!param || value === undefined)
      throw new QueryError(`${template.name} needs a value for ${name}.`);
    return writers[param.kind](value);
  });
}

/**
 * A Redis saved query: its words, each filled as one argument. The command takes no placeholder.
 *
 * @param template - The saved query.
 * @param request - The connector and the values.
 * @returns The query.
 * @throws {QueryError} For a placeholder in the command, or a value that does not fit.
 */
function redisQuery(template: SavedQuery, request: DataOf<'saved'>): PanelQuery {
  const [command = '', ...words] = redisWords(template.query);
  if (command.includes('{{')) throw new QueryError('A Redis command takes no placeholder.');
  const args = words.map((word) => filled(template, word, request.params, redisWriters));
  return templateQuery(request.connector, 'redis', { command, args });
}

/**
 * The panel query of a saved query, its placeholders filled for its language.
 *
 * @param template - The saved query.
 * @param request - The connector and the values.
 * @param context - Each connector's dialect.
 * @returns The query.
 * @throws {QueryError} When a value does not fit, or the filled query is not a template.
 */
function savedQuery(
  template: SavedQuery,
  request: DataOf<'saved'>,
  context: BuildContext,
): PanelQuery {
  const { connector, params } = request;
  switch (template.language) {
    case 'sql': {
      const writers = sqlWriters(sqlWriterFor(context.dialectOf?.(connector)));
      return {
        refId: 'A',
        connector,
        language: 'sql',
        sql: filled(template, template.query, params, writers),
      };
    }
    case 'promql':
    case 'logql': {
      const writers = template.language === 'promql' ? promqlWriters : logqlWriters;
      const expr = filled(template, template.query, params, writers);
      return { refId: 'A', connector, language: template.language, expr };
    }
    case 'redis':
      return redisQuery(template, request);
    default:
      return templateQuery(connector, template.language, filledJson(template, params));
  }
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
  return {
    queries: [savedQuery(template, request, context)],
    output: { shape: template.shape, columns: [], chart: chartsByShape[template.shape] },
  };
}
