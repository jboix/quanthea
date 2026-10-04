/**
 * Loads an alert thread's draft and changes it through the API: the alert with its latest
 * version, the channels to name, a hand edit, activation, a test notification, and the previews
 * of what each channel would send. The browser never sends a query: replays and tests name a
 * saved version.
 */
import {
  type AlertDetail,
  type AlertSpec,
  activateAlertEndpoint,
  alertSpecSchema,
  getAlertEndpoint,
  handEditAlertEndpoint,
  type MessageTemplate,
  type NotifiedSeries,
  notificationValues,
  pickChannelsEndpoint,
  previewNotificationEndpoint,
  testAlertEndpoint,
} from '@quanthea/shared';
import type { ActionFunctionArgs } from 'react-router';
import { type ApiClient, ApiError } from '../../lib/api-client.ts';

/** A channel a draft may name. */
export interface ChannelChoice {
  /** Its id. */
  readonly id: string;
  /** Its name. */
  readonly name: string;
  /** Its service, such as `slack`. */
  readonly kind: string;
}

/** An alert thread's draft, as the draft pane shows it. */
export interface AlertDraftData {
  /** The alert. */
  readonly alert: AlertDetail;
  /** The latest version. */
  readonly version: number;
  /** Its spec. */
  readonly spec: AlertSpec;
  /** Every channel, to name the draft's. */
  readonly channels: readonly ChannelChoice[];
}

/**
 * Loads a thread's alert draft.
 *
 * @param api - The API client.
 * @param alertId - The thread's alert, once it has one.
 * @param signal - Aborted when the navigation changes.
 * @returns The draft, or `null` before the first version.
 */
export async function loadAlertDraft(
  api: ApiClient,
  alertId: string | null,
  signal: AbortSignal,
): Promise<AlertDraftData | null> {
  if (alertId === null) return null;
  const options = { signal };
  const [alert, { channels }] = await Promise.all([
    api.call(getAlertEndpoint, { params: { alertId } }, options),
    api.call(pickChannelsEndpoint, undefined, options),
  ]);
  const latest = alert.versions.reduce((found, each) =>
    each.version > found.version ? each : found,
  );
  return { alert, version: latest.version, spec: alertSpecSchema.parse(latest.spec), channels };
}

/** What the draft pane asks of the thread's route action. */
export type AlertIntent =
  | { readonly intent: 'handEdit'; readonly spec: AlertSpec; readonly note?: string }
  | { readonly intent: 'activateAlert'; readonly alertId: string; readonly version: number }
  | {
      readonly intent: 'testAlert';
      readonly alertId: string;
      readonly version: number;
      readonly series?: NotifiedSeries | undefined;
    };

/**
 * Whether an intent is the draft pane's.
 *
 * @param intent - Any thread intent.
 * @returns Whether it is an alert intent.
 */
export function isAlertIntent(intent: { readonly intent: string }): intent is AlertIntent {
  return ['handEdit', 'activateAlert', 'testAlert'].includes(intent.intent);
}

/**
 * What the test send says: which channels got it.
 *
 * @param results - Each channel's result.
 * @param channels - The channels, for their names.
 * @returns Such as `Sent to On call.`, or what failed.
 */
function sentText(
  results: readonly { channelId: string; ok: boolean; error: string | null }[],
  channels: readonly ChannelChoice[],
): string {
  const name = (id: string) => channels.find((channel) => channel.id === id)?.name ?? id;
  const sent = results.filter((each) => each.ok).map((each) => name(each.channelId));
  const failed = results
    .filter((each) => !each.ok)
    .map((each) => `${name(each.channelId)} (${each.error ?? 'failed'})`);
  return [
    sent.length > 0 ? `Test sent to ${sent.join(', ')}.` : '',
    failed.length > 0 ? `Not sent to ${failed.join(', ')}.` : '',
  ]
    .join(' ')
    .trim();
}

/**
 * Runs one of the draft pane's intents.
 *
 * @param api - The API client.
 * @param threadId - The thread.
 * @param intent - The intent.
 * @returns What to tell the person, if anything.
 */
export async function runAlertIntent(
  api: ApiClient,
  threadId: string,
  intent: AlertIntent,
): Promise<string | undefined> {
  if (intent.intent === 'handEdit') {
    const body = { spec: intent.spec, ...(intent.note ? { note: intent.note } : {}) };
    await api.call(handEditAlertEndpoint, { params: { threadId }, body });
    return undefined;
  }
  const params = { alertId: intent.alertId };
  if (intent.intent === 'activateAlert') {
    await api.call(activateAlertEndpoint, { params, body: { version: intent.version } });
    return `Version ${intent.version} is active.`;
  }
  const { channels } = await api.call(pickChannelsEndpoint);
  const body = intent.series ? { series: intent.series } : {};
  const { results } = await api.call(testAlertEndpoint, {
    params: { ...params, version: String(intent.version) },
    body,
  });
  return sentText(results, channels);
}

/**
 * The message of an API error, with the issues it carries by path.
 *
 * @param error - The error.
 * @returns Such as `This version cannot be activated. query: Unknown query.`
 */
export function errorText(error: ApiError): string {
  const issues = Array.isArray(error.details)
    ? (error.details as { path?: string; message?: string }[])
    : [];
  const lines = issues.flatMap((issue) =>
    issue.message ? [`${issue.path ?? ''}: ${issue.message}`] : [],
  );
  return [error.message, ...lines.slice(0, 5)].join(' ');
}

/** What the previews action takes: the template and the series to fill it with. */
export interface PreviewRequest {
  /** The spec, for its template, title, severity, threshold and format. */
  readonly spec: AlertSpec;
  /** The alert, for its link. */
  readonly alertId: string;
  /** The series, such as a firing from the replay. */
  readonly series: NotifiedSeries | null;
  /** The kinds to preview. */
  readonly kinds: readonly string[];
}

/** What each kind would send, by kind; or why the previews failed. */
export type PreviewOutcome =
  | { readonly ok: true; readonly previews: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly message: string };

/**
 * The values of a preview: from the series, or a stand-in without one.
 *
 * @param request - The preview request.
 * @returns The template, values, alert and labels the preview endpoint takes.
 */
function previewBody(request: PreviewRequest) {
  const { spec } = request;
  const series = request.series ?? { labels: {}, value: null, since: Date.now() };
  const values = notificationValues(spec, series, `/alerts/${request.alertId}`);
  const template: MessageTemplate = spec.message;
  const alert = { title: spec.title.slice(0, 150), severity: spec.severity };
  return { event: 'alert.firing' as const, template, values, alert, labels: { ...series.labels } };
}

/**
 * The action of the previews resource route: what each kind of the draft's channels would send.
 *
 * @param api - The API client.
 * @returns The action.
 */
export function alertPreviewsAction(api: ApiClient) {
  return async ({ request }: ActionFunctionArgs): Promise<PreviewOutcome> => {
    const body = (await request.json()) as PreviewRequest;
    try {
      const { previews } = await api.call(previewNotificationEndpoint, { body: previewBody(body) });
      const kinds = new Set(body.kinds);
      const byKind = previews
        .filter((each) => kinds.has(each.kind))
        .map((each) => [each.kind, each.body]);
      return { ok: true, previews: Object.fromEntries(byKind) };
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      return { ok: false, message: error.message };
    }
  };
}
