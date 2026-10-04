/**
 * Loads a report thread's draft and changes it through the API: the report with its latest
 * version, the channels and pinned dashboards it names, a hand edit, activation, a test send, and
 * the preview over the latest period. The browser never writes a query: the preview and the hand
 * edits send back the spec the server gave, which the server checks again.
 */
import {
  activateReportEndpoint,
  getDashboardEndpoint,
  getReportEndpoint,
  getThreadEndpoint,
  handEditReportEndpoint,
  pickChannelsEndpoint,
  previewReportEndpoint,
  type ReportDetail,
  type ReportPreview,
  type ReportSpec,
  testReportEndpoint,
} from '@quanthea/shared';
import type { LoaderFunctionArgs } from 'react-router';
import { type ApiClient, ApiError } from '../../lib/api-client.ts';

/** A channel a draft names. */
export interface ChannelChoice {
  /** Its id. */
  readonly id: string;
  /** Its name. */
  readonly name: string;
  /** Its service, such as `slack`. */
  readonly kind: string;
}

/** A pinned dashboard a draft links to. */
export interface DraftLink {
  /** The dashboard. */
  readonly dashboardId: string;
  /** What the link says: its label, else the dashboard's title. */
  readonly label: string;
}

/** A report thread's draft, as the draft pane shows it. */
export interface ReportDraftData {
  /** The report. */
  readonly report: ReportDetail;
  /** The latest version. */
  readonly version: number;
  /** Its spec. */
  readonly spec: ReportSpec;
  /** Every channel, to name the draft's. */
  readonly channels: readonly ChannelChoice[];
  /** The pinned dashboards it links to, named. */
  readonly links: readonly DraftLink[];
}

/**
 * The latest version of a report.
 *
 * @param report - The report.
 * @returns The version and its spec, or `undefined` before the first.
 */
function latestOf(report: ReportDetail) {
  return report.versions.reduce<ReportDetail['versions'][number] | undefined>(
    (found, each) => (found && found.version > each.version ? found : each),
    undefined,
  );
}

/**
 * The draft's links, named by their label or their dashboard's title.
 *
 * @param api - The API client.
 * @param spec - The spec.
 * @param signal - Aborted when the navigation changes.
 * @returns The links.
 */
async function linksOf(api: ApiClient, spec: ReportSpec, signal: AbortSignal) {
  return Promise.all(
    spec.seeAlso.map(async ({ dashboardId, label }) => {
      if (label) return { dashboardId, label };
      const params = { dashboardId };
      const dashboard = await api
        .call(getDashboardEndpoint, { params }, { signal })
        .catch(() => null);
      return { dashboardId, label: dashboard?.title ?? 'A dashboard' };
    }),
  );
}

/**
 * Loads a thread's report draft.
 *
 * @param api - The API client.
 * @param reportId - The thread's report, once it has one.
 * @param signal - Aborted when the navigation changes.
 * @returns The draft, or `null` before the first version.
 */
export async function loadReportDraft(
  api: ApiClient,
  reportId: string | null,
  signal: AbortSignal,
): Promise<ReportDraftData | null> {
  if (reportId === null) return null;
  const options = { signal };
  const [report, { channels }] = await Promise.all([
    api.call(getReportEndpoint, { params: { reportId } }, options),
    api.call(pickChannelsEndpoint, undefined, options),
  ]);
  const latest = latestOf(report);
  if (!latest) return null;
  const links = await linksOf(api, latest.spec, signal);
  return { report, version: latest.version, spec: latest.spec, channels, links };
}

/** What the report draft pane asks of the thread's route action. */
export type ReportIntent =
  | { readonly intent: 'handEditReport'; readonly spec: ReportSpec }
  | { readonly intent: 'activateReport'; readonly reportId: string; readonly version: number }
  | { readonly intent: 'testReport'; readonly reportId: string; readonly version: number };

/**
 * Whether an intent is the report draft pane's.
 *
 * @param intent - Any thread intent.
 * @returns Whether it is a report intent.
 */
export function isReportIntent(intent: { readonly intent: string }): intent is ReportIntent {
  return ['handEditReport', 'activateReport', 'testReport'].includes(intent.intent);
}

/**
 * What a test send says: which channels got it.
 *
 * @param results - Each channel's result.
 * @param channels - The channels, for their names.
 * @returns Such as `Test sent to Sales.`, or what failed.
 */
function sentText(
  results: readonly { channelId: string; ok: boolean; error: string | null }[],
  channels: readonly ChannelChoice[],
): string {
  const name = (id: string) => channels.find((channel) => channel.id === id)?.name ?? id;
  const sent = results.filter((each) => each.ok).map((each) => name(each.channelId));
  const failed = results.filter((each) => !each.ok);
  const failures = failed.map((each) => `${name(each.channelId)} (${each.error ?? 'failed'})`);
  const lines = [
    sent.length > 0 ? `Test sent to ${sent.join(', ')}.` : '',
    failures.length > 0 ? `Not sent to ${failures.join(', ')}.` : '',
  ];
  return lines.join(' ').trim();
}

/**
 * Runs one of the report draft pane's intents.
 *
 * @param api - The API client.
 * @param threadId - The thread.
 * @param intent - The intent.
 * @returns What to tell the person, if anything.
 */
export async function runReportIntent(
  api: ApiClient,
  threadId: string,
  intent: ReportIntent,
): Promise<string | undefined> {
  if (intent.intent === 'handEditReport') {
    await api.call(handEditReportEndpoint, { params: { threadId }, body: { spec: intent.spec } });
    return undefined;
  }
  const { reportId, version } = intent;
  if (intent.intent === 'activateReport') {
    await api.call(activateReportEndpoint, { params: { reportId }, body: { version } });
    return `Version ${version} is active.`;
  }
  const { channels } = await api.call(pickChannelsEndpoint);
  const params = { reportId, version: String(version) };
  const { results } = await api.call(testReportEndpoint, { params });
  return sentText(results, channels);
}

/** A preview of the draft, or why there is none. */
export type PreviewOutcome =
  | { readonly ok: true; readonly version: number; readonly preview: ReportPreview }
  | { readonly ok: false; readonly message: string };

/**
 * Previews the thread's latest report version over its latest period.
 *
 * @param api - The API client.
 * @param threadId - The thread.
 * @param signal - Aborted when the fetcher gives up.
 * @returns The preview, or why there is none.
 */
async function previewThread(
  api: ApiClient,
  threadId: string,
  signal: AbortSignal,
): Promise<PreviewOutcome> {
  const options = { signal };
  const { reportId } = await api.call(getThreadEndpoint, { params: { threadId } }, options);
  if (!reportId) return { ok: false, message: 'No draft yet.' };
  const report = await api.call(getReportEndpoint, { params: { reportId } }, options);
  const latest = latestOf(report);
  if (!latest) return { ok: false, message: 'No draft yet.' };
  const body = { spec: latest.spec };
  const preview = await api.call(previewReportEndpoint, { body }, options);
  return { ok: true, version: latest.version, preview };
}

/**
 * The loader of the preview resource route: the latest draft run over its latest period, stored
 * nowhere. A refusal comes back as a message for the pane.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function reportPreviewLoader(api: ApiClient) {
  return async ({ params, request }: LoaderFunctionArgs): Promise<PreviewOutcome> => {
    try {
      return await previewThread(api, params.threadId ?? '', request.signal);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      return { ok: false, message: error.message };
    }
  };
}
