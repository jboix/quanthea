/** Builds a data request into its queries and the table they return. */
import type { SavedQuery } from '@querent/shared';
import type { BuiltData } from './built.ts';
import { gaugeData, latencyData, rateData, ratioData, topData } from './promql.ts';
import type { DataOf, DataRequest } from './request.ts';
import { savedData } from './saved.ts';
import { breakdownData, rowsData, seriesData, statData } from './sql.ts';

/** The builder of each kind but saved queries. */
const builders: {
  readonly [Kind in Exclude<DataRequest['kind'], 'saved'>]: (request: DataOf<Kind>) => BuiltData;
} = {
  rate: rateData,
  ratio: ratioData,
  latency: latencyData,
  gauge: gaugeData,
  top: topData,
  'sql-series': seriesData,
  'sql-breakdown': breakdownData,
  'sql-stat': statData,
  'sql-rows': rowsData,
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
 * @param saved - The saved queries the run may use.
 * @returns The queries and their output.
 * @throws {QueryError} When the request names something a query cannot use.
 */
export function buildData(request: DataRequest, saved: readonly SavedQuery[] = []): BuiltData {
  if (request.kind === 'saved') return savedData(request, saved);
  const build = builders[request.kind] as (request: DataRequest) => BuiltData;
  return build(request);
}
