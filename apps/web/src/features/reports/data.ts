/**
 * Loads reports and their runs and changes them through the API: the list, a run with its report,
 * the latest run of a report, and the report settings. Opening a run runs no query; the server
 * records it as seen for the reader.
 */
import {
  activateReportEndpoint,
  deactivateReportEndpoint,
  getReportEndpoint,
  getReportRunEndpoint,
  getReportSettingsEndpoint,
  listReportRunsEndpoint,
  listReportsEndpoint,
  type ReportDetail,
  type ReportListItem,
  type ReportRunDetail,
  type ReportSettings,
  runReportNowEndpoint,
  saveReportSettingsEndpoint,
} from '@quanthea/shared';
import { type ActionFunctionArgs, data, type LoaderFunctionArgs, redirect } from 'react-router';
import { type ApiClient, ApiError } from '../../lib/api-client.ts';

/** The id of the list's route, whose data the rail reads while the list is on screen. */
export const reportsRouteId = 'reports';

/** The resource route of the report settings, which the Reports page's Settings dialog loads. */
export const reportSettingsPath = '/reports/settings';

/** The resource route that counts the reports with a run the person has not opened. */
export const unseenPath = '/reports/unseen';

/** What the reports list shows. */
export interface ReportsData {
  /** Every report the role sees, as the person reads them. */
  readonly reports: readonly ReportListItem[];
}

/** What a run's page shows: the report, and the run, or none before the first. */
export interface RunData {
  /** The report with its versions. */
  readonly report: ReportDetail;
  /** The run, with its frozen results; `null` when the report has not run yet. */
  readonly run: ReportRunDetail | null;
}

/** What the run page's menus submit, as JSON. */
export type ReportIntent =
  | { readonly intent: 'run' }
  | { readonly intent: 'activate'; readonly version: number }
  | { readonly intent: 'deactivate' };

/** What an intent or a save answers. */
export type ReportOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

/**
 * A 404 for the error page, from an API "not found".
 *
 * @param error - What the call threw.
 * @returns The response to throw, or the error itself.
 */
function notFound(error: unknown): unknown {
  if (error instanceof ApiError && error.code === 'not_found')
    return data(null, { status: 404, statusText: 'Not Found' });
  return error;
}

/**
 * Loads the reports the role sees.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadReports(api: ApiClient) {
  return async ({ request }: LoaderFunctionArgs): Promise<ReportsData> =>
    api.call(listReportsEndpoint, undefined, { signal: request.signal });
}

/**
 * Loads how many reports have a run the person has not opened, for the rail. A failure gives no
 * count, so the rail never breaks the screen.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadUnseen(api: ApiClient) {
  const load = loadReports(api);
  return async (args: LoaderFunctionArgs): Promise<{ readonly unseen: number | null }> => {
    try {
      return { unseen: (await load(args)).reports.filter((each) => each.unseen).length };
    } catch {
      return { unseen: null };
    }
  };
}

/**
 * Loads a run with its report. A run or a report the role may not see is a 404.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadRun(api: ApiClient) {
  return async ({ params, request }: LoaderFunctionArgs): Promise<RunData> => {
    const reportId = params.reportId ?? '';
    const { signal } = request;
    try {
      const [report, run] = await Promise.all([
        api.call(getReportEndpoint, { params: { reportId } }, { signal }),
        api.call(
          getReportRunEndpoint,
          { params: { reportId, runId: params.runId ?? '' } },
          { signal },
        ),
      ]);
      return { report, run };
    } catch (error) {
      throw notFound(error);
    }
  };
}

/**
 * Loads a report's page: it redirects to its latest run, or shows the report before its first.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadLatestRun(api: ApiClient) {
  return async ({ params, request }: LoaderFunctionArgs): Promise<RunData | Response> => {
    const reportId = params.reportId ?? '';
    const { signal } = request;
    try {
      const input = { params: { reportId }, query: { limit: 1 } };
      const [latest] = (await api.call(listReportRunsEndpoint, input, { signal })).runs;
      if (latest) return redirect(`/reports/${reportId}/runs/${latest.id}`);
      return {
        report: await api.call(getReportEndpoint, { params: { reportId } }, { signal }),
        run: null,
      };
    } catch (error) {
      throw notFound(error);
    }
  };
}

/**
 * Runs one intent.
 *
 * @param api - The API client.
 * @param reportId - The report.
 * @param intent - The intent.
 * @returns The new run's page after Run now, else that it went through.
 */
async function runIntent(
  api: ApiClient,
  reportId: string,
  intent: ReportIntent,
): Promise<ReportOutcome | Response> {
  const params = { reportId };
  if (intent.intent === 'run') {
    const run = await api.call(runReportNowEndpoint, { params, body: { send: false } });
    return redirect(`/reports/${reportId}/runs/${run.id}`);
  }
  if (intent.intent === 'activate')
    await api.call(activateReportEndpoint, { params, body: { version: intent.version } });
  else await api.call(deactivateReportEndpoint, { params });
  return { ok: true };
}

/**
 * The action of a run's page: run the report now, activate a version, or deactivate it. Running
 * opens the new run.
 *
 * @param api - The API client.
 * @returns The action. A refusal comes back as a message.
 */
export function changeReport(api: ApiClient) {
  return async ({ params, request }: ActionFunctionArgs): Promise<ReportOutcome | Response> => {
    const intent = (await request.json()) as ReportIntent;
    try {
      return await runIntent(api, params.reportId ?? '', intent);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status >= 500) throw error;
      return { ok: false, message: error.message };
    }
  };
}

/**
 * Loads the report settings, for admins.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadReportSettings(api: ApiClient) {
  return async ({ request }: LoaderFunctionArgs): Promise<ReportSettings> =>
    api.call(getReportSettingsEndpoint, undefined, { signal: request.signal });
}

/**
 * Saves the report settings.
 *
 * @param api - The API client.
 * @returns The action. A refusal comes back as a message.
 */
export function saveReportSettings(api: ApiClient) {
  return async ({ request }: ActionFunctionArgs): Promise<ReportOutcome> => {
    try {
      const body = (await request.json()) as ReportSettings;
      await api.call(saveReportSettingsEndpoint, { body });
      return { ok: true };
    } catch (error) {
      if (!(error instanceof ApiError) || error.status >= 500) throw error;
      return { ok: false, message: error.message };
    }
  };
}
