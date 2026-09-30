/** Builds a data request into its queries and the table they return. */
import type { BuildContext, BuiltData } from './built.ts';
import { gaugeData, latencyData, rateData, ratioData, topData } from './promql.ts';
import type { DataOf, DataRequest } from './request.ts';
import { savedData } from './saved.ts';
import { breakdownData, rowsData, seriesData, statData } from './sql.ts';
import { type SqlWriter, sqlWriterFor } from './sql-writers.ts';

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
  const { connector, language, query, instant } = request;
  const built =
    language === 'sql'
      ? { refId: 'A', connector, language, sql: query }
      : { refId: 'A', connector, language, expr: query, ...(instant ? { instant: true } : {}) };
  return { queries: [built], output: { shape: 'rows', columns: [], chart: 'table.rows' } };
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
