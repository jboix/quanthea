/**
 * A run's charts drawn again at another interval. A run keeps its results as they ran, so another
 * interval asks the server to run the charts' queries again over the run's period: the browser
 * names the run and an interval of the closed list, never a query. What comes back is drawn in
 * place of the stored charts and stored nowhere; the numbers of the run stay as they were.
 */
import {
  type ChartInterval,
  chartIntervalChoices,
  followsChartInterval,
  type PanelRun,
  type ReportRedraw,
  type ReportRunDetail,
  redrawReportRunEndpoint,
} from '@quanthea/shared';
import type { LoaderFunctionArgs } from 'react-router';
import { type ApiClient, ApiError } from '../../lib/api-client.ts';
import { intervalParam } from '../dashboard/index.ts';

/** What a redraw answers: the charts, or why they could not be drawn again. */
export type RedrawOutcome =
  | { readonly ok: true; readonly redraw: ReportRedraw }
  | { readonly ok: false; readonly message: string };

/**
 * The resource route that draws a run's charts again.
 *
 * @param reportId - The report.
 * @param runId - The run.
 * @param interval - The interval chosen.
 * @returns The path, with the interval as its parameter.
 */
export function redrawPath(reportId: string, runId: string, interval: ChartInterval): string {
  const run = `/reports/${encodeURIComponent(reportId)}/runs/${encodeURIComponent(runId)}`;
  return `${run}/redraw?interval=${interval}`;
}

/**
 * The intervals a run's charts can be drawn at: those that suit its period, when at least one of
 * its charts has a query that follows the interval. A run whose charts all name a fixed step has
 * none, and its page offers no choice.
 *
 * @param run - The run.
 * @returns The intervals, finest first; none when no chart would change.
 */
export function redrawChoices(run: ReportRunDetail): ChartInterval[] {
  const follows = run.spec.panels.some(
    (panel) => panel.view.kind === 'chart' && panel.queries.some(followsChartInterval),
  );
  return follows ? chartIntervalChoices(run.period.to - run.period.from) : [];
}

/**
 * The panels a run's page draws: the stored ones, with the charts drawn again in their place.
 *
 * @param stored - Each panel's stored run, by panel id.
 * @param redraw - The charts drawn again, if any.
 * @returns Each panel's run to draw.
 */
export function drawnPanels(
  stored: Readonly<Record<string, PanelRun>>,
  redraw: ReportRedraw | undefined,
): Readonly<Record<string, PanelRun>> {
  return redraw ? { ...stored, ...redraw.panels } : stored;
}

/**
 * Asks the server for a run's charts at an interval.
 *
 * @param api - The API client.
 * @param args - The route's parameters and request.
 * @param interval - The interval.
 * @returns The charts. A refusal or a failing source comes back as a message.
 */
async function redrawAt(
  api: ApiClient,
  { params, request }: LoaderFunctionArgs,
  interval: ChartInterval,
): Promise<RedrawOutcome> {
  const names = { reportId: params.reportId ?? '', runId: params.runId ?? '' };
  try {
    const input = { params: names, body: { interval } };
    const redraw = await api.call(redrawReportRunEndpoint, input, { signal: request.signal });
    return { ok: true, redraw };
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return { ok: false, message: error.message };
  }
}

/**
 * Loads a run's charts at the interval the URL names.
 *
 * @param api - The API client.
 * @returns The loader. Anything but an interval of the closed list is refused here.
 */
export function loadRunRedraw(api: ApiClient) {
  return async (args: LoaderFunctionArgs): Promise<RedrawOutcome> => {
    const interval = intervalParam(new URL(args.request.url).searchParams.get('interval'));
    if (!interval) return { ok: false, message: 'Choose an interval of the list.' };
    return redrawAt(api, args, interval);
  };
}
