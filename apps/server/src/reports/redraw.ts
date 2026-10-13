/**
 * Draws the charts of a stored run again at another interval. A run keeps the results of its
 * queries, cut as they ran, so another interval needs the queries again: the chart panels whose
 * queries follow the interval run over the run's own period, from the spec of the run's version,
 * as the data is now. Nothing is stored: the run, its numbers and its message stay as they were.
 */
import {
  type ChartInterval,
  fitsPeriod,
  followsChartInterval,
  type ReportRedraw,
  type ReportSpec,
} from '@quanthea/shared';
import { AppError } from '../lib/errors.ts';
import type { ReaderRole } from '../lib/reader-role.ts';
import type { ReportsContext } from './context.ts';
import { runPeriod } from './execute.ts';
import { readRun } from './reading.ts';

/**
 * The panels of a spec another interval draws differently: the charts with a query that follows
 * the interval. Numbers and tables keep what the run stored.
 *
 * @param spec - The report spec.
 * @returns The panels.
 */
export function redrawnPanels(spec: ReportSpec): ReportSpec['panels'] {
  return spec.panels.filter(
    (panel) => panel.view.kind === 'chart' && panel.queries.some(followsChartInterval),
  );
}

/**
 * Runs the charts of a run again over its period, cut at an interval of the closed list.
 *
 * @param context - The service context.
 * @param id - The report.
 * @param runId - The run.
 * @param interval - The interval.
 * @param reader - The role of the reader, or how to find it from the report's thread.
 * @returns The interval and each chart's new run, by panel id. A chart whose query fails now
 *   comes with its failure.
 * @throws {AppError} `not_found` for a run the role may not see, `bad_request` for a run without
 *   results or an interval that does not suit its period.
 */
export async function redrawRun(
  context: ReportsContext,
  id: string,
  runId: string,
  interval: ChartInterval,
  reader: ReaderRole,
): Promise<ReportRedraw> {
  const run = readRun(context, id, runId, reader);
  if (run.status !== 'ok') throw new AppError('bad_request', 'This run has no charts to draw.');
  if (!fitsPeriod(interval, run.period.to - run.period.from))
    throw new AppError('bad_request', `${interval} does not suit the period of this run.`);
  const spec = { ...run.spec, panels: redrawnPanels(run.spec) };
  const runner = { openSource: context.openSource, executor: context.executor, now: context.now };
  const { panels } = await runPeriod(runner, spec, run.period, interval);
  return { interval, panels };
}
