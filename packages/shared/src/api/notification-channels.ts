/**
 * Notification channels: where alerts send their messages. Admins add and change channels, since a
 * message leaves quanthea when it is sent; editors pick channels for an alert and preview what each
 * service would receive. A channel's URL, routing key and signing secret are sealed at rest and
 * never come back: the views carry a masked form.
 */
import { z } from 'zod';
import {
  messagePlaceholders,
  messageTemplateSchema,
  notificationEvents,
} from '../notifications.ts';
import { channelEvents } from '../report-notifications.ts';
import { defineEndpoint } from './contract.ts';

/** The services a channel can send to. */
export const channelKinds = ['webhook', 'slack', 'discord', 'teams', 'pagerduty'] as const;

/** Validates a channel kind. */
export const channelKindSchema = z.enum(channelKinds);

/** A channel kind. */
export type ChannelKind = z.infer<typeof channelKindSchema>;

/** What a kind of channel takes, for the forms and the checks. */
interface ChannelKindInfo {
  /** The service's name. */
  readonly label: string;
  /** What the target is: a webhook URL, or PagerDuty's routing key. */
  readonly target: 'url' | 'routing-key';
  /** Whether the target may be plain `http:` (only a generic webhook on a private network). */
  readonly allowsHttp: boolean;
  /** Whether the channel may sign its requests with a secret. */
  readonly signs: boolean;
  /** The mentions it accepts, or `null` when it takes none. */
  readonly mentions: RegExp | null;
  /** An example of a mention, for the form. */
  readonly mentionExample?: string;
}

/** Each kind's form and checks. */
export const channelKindInfo: Readonly<Record<ChannelKind, ChannelKindInfo>> = {
  webhook: { label: 'Webhook', target: 'url', allowsHttp: true, signs: true, mentions: null },
  slack: {
    label: 'Slack',
    target: 'url',
    allowsHttp: false,
    signs: false,
    mentions: /^<(?:!here|!channel|!subteam\^[A-Z0-9]{2,30}|@[UW][A-Z0-9]{2,30})>$/,
    mentionExample: '<!subteam^S0123ABCD>',
  },
  discord: {
    label: 'Discord',
    target: 'url',
    allowsHttp: false,
    signs: false,
    mentions: /^<@&?\d{5,25}>$/,
    mentionExample: '<@&123456789012345678>',
  },
  teams: {
    label: 'Microsoft Teams',
    target: 'url',
    allowsHttp: false,
    signs: false,
    mentions: null,
  },
  pagerduty: {
    label: 'PagerDuty',
    target: 'routing-key',
    allowsHttp: false,
    signs: false,
    mentions: null,
  },
};

/** An absolute URL: its scheme, its authority, then any path, query or fragment. */
const urlPattern = /^([a-z][a-z0-9+.-]*):\/\/([^/?#\s]+)(?:[/?#]\S*)?$/i;

/** A PagerDuty integration's routing key. */
const routingKeyPattern = /^[A-Za-z0-9]{32}$/;

/**
 * Why a channel's target cannot be used, if it cannot.
 *
 * @param kind - The channel kind.
 * @param target - The URL or routing key.
 * @returns The reason, or `undefined` when the target fits the kind.
 */
export function targetProblem(kind: ChannelKind, target: string): string | undefined {
  const info = channelKindInfo[kind];
  if (info.target === 'routing-key')
    return routingKeyPattern.test(target) ? undefined : 'A routing key is 32 letters and digits.';
  return urlProblem(target, info.allowsHttp);
}

/**
 * Why a webhook URL cannot be used, if it cannot.
 *
 * @param target - The URL.
 * @param allowsHttp - Whether plain `http:` is allowed.
 * @returns The reason, or `undefined` when the URL is fine.
 */
function urlProblem(target: string, allowsHttp: boolean): string | undefined {
  const [, scheme = '', authority = ''] = urlPattern.exec(target) ?? [];
  const schemes = allowsHttp ? ['https', 'http'] : ['https'];
  if (!schemes.includes(scheme.toLowerCase()))
    return allowsHttp ? 'Use an http or https URL.' : 'Use an https URL.';
  if (authority.includes('@')) return 'Put no user name or password in the URL.';
  return undefined;
}

/** The fields of a channel as an admin writes them. */
const channelFields = z.strictObject({
  name: z.string().trim().min(1).max(80),
  kind: channelKindSchema,
  /** The webhook URL, or PagerDuty's routing key. */
  target: z.string().trim().min(1).max(2000),
  /** The generic webhook's signing secret, if it signs. */
  signingSecret: z.string().min(16).max(256).optional(),
  /** Who to mention when an alert starts firing, in the service's syntax. */
  mentions: z.array(z.string().trim().min(1).max(64)).max(10).default([]),
});

/** Validates a new channel, or a channel once a change is applied to it. */
export const channelInputSchema = channelFields.superRefine((channel, context) => {
  const info = channelKindInfo[channel.kind];
  const problem = targetProblem(channel.kind, channel.target);
  if (problem) context.addIssue({ code: 'custom', path: ['target'], message: problem });
  if (channel.signingSecret !== undefined && !info.signs)
    context.addIssue({
      code: 'custom',
      path: ['signingSecret'],
      message: 'This kind signs nothing.',
    });
  channel.mentions.forEach((mention, index) => {
    if (info.mentions?.test(mention)) return;
    const message = info.mentions
      ? `Write a mention as ${info.mentionExample}.`
      : `${info.label} channels take no mentions.`;
    context.addIssue({ code: 'custom', path: ['mentions', index], message });
  });
});

/** A new channel, as validated. */
export type ChannelInput = z.output<typeof channelInputSchema>;

/**
 * Validates a change to a channel. Omitted fields keep their value; a `null` signing secret stops
 * signing. The kind never changes.
 */
export const channelPatchSchema = z.strictObject({
  name: channelFields.shape.name.optional(),
  target: channelFields.shape.target.optional(),
  signingSecret: channelFields.shape.signingSecret.unwrap().nullable().optional(),
  mentions: channelFields.shape.mentions.unwrap().optional(),
});

/** A change to a channel. */
export type ChannelPatch = z.output<typeof channelPatchSchema>;

/** Validates a channel as admins see it: the target masked, the secret never. */
export const channelViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: channelKindSchema,
  /** The target, masked, such as `hooks.slack.com/services/…/9fQx`. */
  target: z.string(),
  /** Whether the generic webhook signs its requests. */
  signed: z.boolean(),
  mentions: z.array(z.string()),
  /** The name of the admin who added it. */
  createdBy: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  /** The last time a message got through, in epoch milliseconds. */
  lastSentAt: z.number().nullable(),
  /** The last failure, with the service's HTTP status when it answered. */
  lastError: z
    .object({ at: z.number(), message: z.string(), status: z.int().nullable() })
    .nullable(),
  /** How many alerts send to it. */
  alerts: z.int(),
});

/** A channel as admins see it. */
export type ChannelView = z.infer<typeof channelViewSchema>;

/** Validates one message sent to a channel, as its log keeps it. */
export const channelSendSchema = z.object({
  id: z.string(),
  event: z.enum(channelEvents),
  /** The alert it came from; empty for a report's message. */
  alertId: z.string(),
  /** The report it came from; `null` for an alert's message. */
  reportId: z.string().nullable(),
  /** The series it was about; the run for a report's message. */
  seriesKey: z.string(),
  at: z.number(),
  ok: z.boolean(),
  /** The service's HTTP status, or `null` when it never answered. */
  httpStatus: z.int().nullable(),
  attempts: z.int(),
  /** Why it failed, without the target. */
  error: z.string().nullable(),
});

/** One message sent to a channel. */
export type ChannelSend = z.infer<typeof channelSendSchema>;

/** Validates the outcome of sending to one channel. */
export const sendResultSchema = z.object({
  channelId: z.string(),
  ok: z.boolean(),
  httpStatus: z.int().nullable(),
  attempts: z.int(),
  error: z.string().nullable(),
});

/** The outcome of sending to one channel. */
export type SendResult = z.infer<typeof sendResultSchema>;

/** Validates what an editor previews: a template with values, as one event of one alert. */
export const previewInputSchema = z.strictObject({
  /** The kind to preview; every kind when omitted. */
  kind: channelKindSchema.optional(),
  event: z.enum(notificationEvents).default('alert.firing'),
  template: messageTemplateSchema,
  values: z.partialRecord(z.enum(messagePlaceholders), z.string().max(500)).default({}),
  alert: z
    .strictObject({
      title: z.string().min(1).max(150),
      severity: z.enum(['critical', 'warning', 'info']),
    })
    .default({ title: 'Alert', severity: 'warning' }),
  labels: z.record(z.string().max(100), z.string().max(500)).default({}),
});

/** What an editor previews. */
export type PreviewInput = z.output<typeof previewInputSchema>;

/** Validates what each kind would send: the JSON body. */
export const channelPreviewSchema = z.object({ kind: channelKindSchema, body: z.unknown() });

/** An example message, for the test send and the example the settings show. */
export const sampleMessage = {
  template: {
    title: '{alert} is {value}',
    body: '{series} has been above {threshold} for {duration}, since {since}.',
    fields: [
      { label: 'Value', value: '{value}' },
      { label: 'Threshold', value: '{threshold}' },
    ],
  },
  values: {
    alert: 'Checkout 5xx rate',
    series: 'service=checkout',
    value: '3.4%',
    threshold: '2%',
    duration: '5m',
    since: '2026-10-04T12:17:00Z',
    severity: 'warning',
  },
  alert: { title: 'Checkout 5xx rate', severity: 'warning' },
  labels: { service: 'checkout' },
} as const satisfies Omit<PreviewInput, 'kind' | 'event'>;

/** The path parameter of one channel. */
const channelParams = z.object({ channelId: z.string().min(1).max(64) });

/** Lists every channel, by name. */
export const listChannelsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/settings/notification-channels',
  output: z.object({ channels: z.array(channelViewSchema) }),
});

/** Adds a channel. */
export const createChannelEndpoint = defineEndpoint({
  method: 'POST',
  path: '/settings/notification-channels',
  body: channelInputSchema,
  output: channelViewSchema,
});

/** Changes a channel. */
export const updateChannelEndpoint = defineEndpoint({
  method: 'PATCH',
  path: '/settings/notification-channels/:channelId',
  params: channelParams,
  body: channelPatchSchema,
  output: channelViewSchema,
});

/** Deletes a channel no alert sends to. */
export const deleteChannelEndpoint = defineEndpoint({
  method: 'DELETE',
  path: '/settings/notification-channels/:channelId',
  params: channelParams,
  output: z.object({ deleted: z.literal(true) }),
});

/** Sends a test message to a channel, and says how it went. */
export const testChannelEndpoint = defineEndpoint({
  method: 'POST',
  path: '/settings/notification-channels/:channelId/test',
  params: channelParams,
  output: sendResultSchema,
});

/** Lists a channel's recent sends, the newest first. */
export const listChannelSendsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/settings/notification-channels/:channelId/sends',
  params: channelParams,
  output: z.object({ sends: z.array(channelSendSchema) }),
});

/** Lists the channels by name and kind only, for picking one for an alert. */
export const pickChannelsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/notification-channels',
  output: z.object({
    channels: z.array(z.object({ id: z.string(), name: z.string(), kind: channelKindSchema })),
  }),
});

/** What each kind would send for a template and its values. Nothing is sent. */
export const previewNotificationEndpoint = defineEndpoint({
  method: 'POST',
  path: '/notification-channels/preview',
  body: previewInputSchema,
  output: z.object({ previews: z.array(channelPreviewSchema) }),
});
