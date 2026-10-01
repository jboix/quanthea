/** Builds a data request into its queries and the table they return. */
import { type PanelQuery, panelQuerySchema } from '@querent/shared';
import type { BuildContext, BuiltData } from './built.ts';
import { gaugeData, latencyData, rateData, ratioData, topData } from './promql.ts';
import type { DataOf, DataRequest } from './request.ts';
import { savedData } from './saved.ts';
import { breakdownData, rowsData, seriesData, statData } from './sql.ts';
import { type SqlWriter, sqlWriterFor } from './sql-writers.ts';
import { QueryError } from './text.ts';

/**
 * The SQL writer for a request's connector.
 *
 * @param context - The build context.
 * @param connector - The connector name.
 * @returns The writer of its dialect.
 */
function writerOf(context: BuildContext, connector: string): SqlWriter {
  return sqlWriterFor(context.dialectOf?.(connector));
}

/** The builder of each kind but saved queries. */
const builders: {
  readonly [Kind in Exclude<DataRequest['kind'], 'saved'>]: (
    request: DataOf<Kind>,
    context: BuildContext,
  ) => BuiltData;
} = {
  rate: rateData,
  ratio: ratioData,
  latency: latencyData,
  gauge: gaugeData,
  top: topData,
  'sql-series': (request, context) => seriesData(request, writerOf(context, request.connector)),
  'sql-breakdown': (request, context) =>
    breakdownData(request, writerOf(context, request.connector)),
  'sql-stat': (request, context) => statData(request, writerOf(context, request.connector)),
  'sql-rows': (request, context) => rowsData(request, writerOf(context, request.connector)),
  raw: rawData,
};

/**
 * A raw query as the model wrote it: its columns are known once it runs.
 *
 * @param request - The request.
 * @returns The query and its output.
 */
function rawData(request: DataOf<'raw'>): BuiltData {
  return {
    queries: [rawQuery(request)],
    output: { shape: 'rows', columns: [], chart: 'table.rows' },
  };
}

/**
 * The panel query of a raw query.
 *
 * @param request - The request.
 * @returns The query, refId A.
 * @throws {QueryError} For a search body that is not a JSON object.
 */
function rawQuery(request: DataOf<'raw'>): PanelQuery {
  const { connector, language, query, instant } = request;
  if (language === 'sql') return { refId: 'A', connector, language, sql: query };
  if (language === 'search')
    return {
      refId: 'A',
      connector,
      language,
      index: request.index ?? '',
      body: jsonObject(query, 'search body'),
    };
  if (language === 'http' || language === 'mongodb') return jsonQuery(connector, query, language);
  if (language === 'redis') return redisQuery(connector, query);
  return { refId: 'A', connector, language, expr: query, ...(instant ? { instant: true } : {}) };
}

/**
 * Reads a JSON object a raw query gives as text.
 *
 * @param text - The JSON text.
 * @param what - What it is, for the message.
 * @returns The object.
 * @throws {QueryError} When the text is not a JSON object.
 */
function jsonObject(text: string, what: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new QueryError(`The ${what} is not valid JSON.`);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new QueryError(`The ${what} is a JSON object.`);
  return value as Record<string, unknown>;
}

/** What the text of a raw query is, by its language, for messages. */
const jsonQueryNames = { http: 'HTTP request', mongodb: 'MongoDB query' } as const;

/**
 * The panel query of a raw query whose text is the JSON of its template: an HTTP request's
 * method, path, query, body and extract, or a MongoDB collection and pipeline.
 *
 * @param connector - The connector.
 * @param text - The JSON of the template without its connector and language.
 * @param language - The language.
 * @returns The query, refId A.
 * @throws {QueryError} When the JSON is not one a template of the language allows.
 */
function jsonQuery(connector: string, text: string, language: 'http' | 'mongodb'): PanelQuery {
  const what = jsonQueryNames[language];
  const fields = jsonObject(text, what);
  const parsed = panelQuerySchema.safeParse({ ...fields, refId: 'A', connector, language });
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  throw new QueryError(
    `The ${what} is invalid at ${issue?.path.join('.') || 'its root'}: ${issue?.message ?? ''}`,
  );
}

/**
 * The panel query of a raw Redis query: the command and its arguments separated by spaces, or a
 * JSON array of them when an argument holds a space.
 *
 * @param connector - The connector.
 * @param text - The command line, or its JSON array.
 * @returns The query, refId A.
 * @throws {QueryError} When the text names no command.
 */
function redisQuery(connector: string, text: string): PanelQuery {
  const [command, ...args] = redisWords(text);
  if (!command) throw new QueryError('A Redis query names a command, such as ZREVRANGE.');
  return { refId: 'A', connector, language: 'redis', command, args };
}

/**
 * The words of a raw Redis query.
 *
 * @param text - The command line, or the JSON array of its words.
 * @returns The words.
 * @throws {QueryError} When the text is a JSON array that does not parse.
 */
function redisWords(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed.startsWith('[')) return trimmed.split(/\s+/).filter(Boolean);
  try {
    return (JSON.parse(trimmed) as unknown[]).map(String);
  } catch {
    throw new QueryError('The Redis command is not a valid JSON array.');
  }
}

/**
 * Builds a data request.
 *
 * @param request - The request.
 * @param context - The saved queries the run may use, and each connector's dialect.
 * @returns The queries and their output.
 * @throws {QueryError} When the request names something a query cannot use.
 */
export function buildData(request: DataRequest, context: BuildContext = { saved: [] }): BuiltData {
  if (request.kind === 'saved') return savedData(request, context);
  const build = builders[request.kind] as (
    request: DataRequest,
    context: BuildContext,
  ) => BuiltData;
  return build(request, context);
}
