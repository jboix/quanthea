/**
 * Alert endpoints: list and read alerts with their state, activate or deactivate a version, mute,
 * and replay a spec over a past window. The server evaluates alerts with no model; versions are
 * never rewritten, and one version at a time is active.
 */
import { z } from 'zod';
import { namedFormatterSchema } from '../formatters/schema.ts';
import { notificationEvents } from '../notifications.ts';
import { alertSeverities, alertSpecSchema } from '../spec/alert.ts';
import { durationSchema } from '../spec/queries.ts';
import { defineEndpoint } from './contract.ts';

/** The states of a series: the condition holds for a while, fires, or the data is missing. */
export const alertStates = ['ok', 'pending', 'firing', 'no_data', 'error'] as const;

/** The state of a series. */
export type AlertState = (typeof alertStates)[number];

/** Validates a series' labels. */
const labelsSchema = z.record(z.string(), z.string());

/** Validates a mute: who muted, and until when (`null`: until someone unmutes). */
const muteSchema = z.object({ until: z.number().nullable(), by: z.string(), at: z.number() });

/** Validates an alert without its history, for lists. */
export const alertSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  /** The severity of the active version, else of the latest. */
  severity: z.enum(alertSeverities),
  activeVersion: z.int().nullable(),
  /** The latest version, maybe a draft; `null` below editor. */
  latestVersion: z.int().nullable(),
  /** Whether evaluation is stopped. */
  deactivated: z.boolean(),
  muted: muteSchema.nullable(),
  /** When it was last evaluated. */
  evaluatedAt: z.number().nullable(),
  /** How many series are in each state. */
  states: z.object({
    ok: z.int(),
    pending: z.int(),
    firing: z.int(),
    no_data: z.int(),
    error: z.int(),
  }),
  /** The conversation that made it, if any. */
  threadId: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

/** An alert without its history. */
export type AlertSummary = z.infer<typeof alertSummarySchema>;

/** Validates the condition of the version shown, as the spec has it. */
const listedConditionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('threshold'),
    op: z.enum(['above', 'below']),
    value: z.number(),
    for: z.string(),
  }),
  z.object({ kind: z.literal('no_data'), for: z.string() }),
]);

/** Validates the series that stands for an alert: the worst state, then the worst value. */
const leadSeriesSchema = z.object({
  labels: labelsSchema,
  state: z.enum(alertStates),
  since: z.number(),
  value: z.number().nullable(),
});

/** Validates the latest message sent about an alert: the channel by name only, never its target. */
const lastNotificationSchema = z.object({
  channel: z.string(),
  at: z.number(),
  ok: z.boolean(),
});

/** Validates an alert as the list shows it: its summary, its condition and its worst series. */
export const alertListItemSchema = alertSummarySchema.extend({
  /** The condition of the active version, else of the latest. */
  condition: listedConditionSchema,
  /** How the value reads, from the same version. */
  format: namedFormatterSchema.nullable(),
  /** The series in the worst state, with the worst value; `null` before the first evaluation. */
  lead: leadSeriesSchema.nullable(),
  /** How many series the last evaluation kept, the alert as a whole included. */
  seriesCount: z.int(),
  /** The latest message sent about it, if any. */
  lastNotification: lastNotificationSchema.nullable(),
});

/** An alert as the list shows it. */
export type AlertListItem = z.infer<typeof alertListItemSchema>;

/** Validates a version of an alert. */
const alertVersionSchema = z.object({
  version: z.int(),
  spec: alertSpecSchema,
  note: z.string().nullable(),
  /** The name of whoever saved it. */
  createdBy: z.string(),
  createdAt: z.number(),
  /** When it was first activated. */
  activatedAt: z.number().nullable(),
});

/** Validates the state of one series. */
const alertSeriesSchema = z.object({
  key: z.string(),
  labels: labelsSchema,
  state: z.enum(alertStates),
  since: z.number(),
  value: z.number().nullable(),
  evaluatedAt: z.number(),
  notifiedAt: z.number().nullable(),
});

/** Validates a change of state, for the timeline. */
const alertEventSchema = z.object({
  version: z.int(),
  seriesKey: z.string(),
  labels: labelsSchema,
  from: z.enum(alertStates),
  to: z.enum(alertStates),
  at: z.number(),
  value: z.number().nullable(),
  /** Why the query failed, for a change to `error`. */
  message: z.string().nullable(),
  /** Whether the change sent a notification. */
  notified: z.boolean(),
});

/** Validates a channel an alert sends to, by name and kind only. */
const alertChannelSchema = z.object({ id: z.string(), name: z.string(), kind: z.string() });

/** Validates a message sent about an alert: the channel by name, never its target. */
const alertSendSchema = z.object({
  channel: z.string(),
  kind: z.string(),
  event: z.enum(notificationEvents),
  seriesKey: z.string(),
  at: z.number(),
  ok: z.boolean(),
});

/** What people did to an alert, for the timeline. */
export const alertActions = ['activate', 'deactivate', 'mute', 'unmute'] as const;

/** Validates something someone did to an alert. */
const alertActivitySchema = z.object({
  action: z.enum(alertActions),
  at: z.number(),
  /** The name of whoever did it. */
  by: z.string(),
  /** The version activated. */
  version: z.int().nullable(),
  /** The end of a mute; `null` until someone unmutes, or for other actions. */
  until: z.number().nullable(),
});

/** Validates an alert with its versions, series and recent changes of state. */
export const alertDetailSchema = alertListItemSchema.extend({
  versions: z.array(alertVersionSchema),
  series: z.array(alertSeriesSchema),
  events: z.array(alertEventSchema),
  /** The channels the version shown sends to; a channel deleted since is left out. */
  channels: z.array(alertChannelSchema),
  /** The latest messages sent about it, the latest first. */
  sends: z.array(alertSendSchema),
  /** Activations, deactivations and mutes, the latest first. */
  activity: z.array(alertActivitySchema),
});

/** An alert with its versions, series and recent changes of state. */
export type AlertDetail = z.infer<typeof alertDetailSchema>;

/** The path parameter of one alert. */
const alertParams = z.object({ alertId: z.string().min(1).max(64) });

/** Lists the alerts with how many series are in each state. */
export const listAlertsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/alerts',
  output: z.object({ alerts: z.array(alertListItemSchema) }),
});

/** Reads an alert. Viewers see the versions that were ever active. */
export const getAlertEndpoint = defineEndpoint({
  method: 'GET',
  path: '/alerts/:alertId',
  params: alertParams,
  output: alertDetailSchema,
});

/** Activates a version: it is checked and its query run once, then evaluation follows it. */
export const activateAlertEndpoint = defineEndpoint({
  method: 'POST',
  path: '/alerts/:alertId/activate',
  params: alertParams,
  body: z.object({ version: z.int().min(1) }),
  output: alertSummarySchema,
});

/** Stops evaluating an alert, keeping its active version. */
export const deactivateAlertEndpoint = defineEndpoint({
  method: 'POST',
  path: '/alerts/:alertId/deactivate',
  params: alertParams,
  output: alertSummarySchema,
});

/** Mutes an alert's notifications; evaluation and state go on. */
export const muteAlertEndpoint = defineEndpoint({
  method: 'POST',
  path: '/alerts/:alertId/mute',
  params: alertParams,
  /** `until` in epoch milliseconds; `null` mutes until someone unmutes, for editors only. */
  body: z.object({ until: z.number().nullable() }),
  output: alertSummarySchema,
});

/** Unmutes an alert. */
export const unmuteAlertEndpoint = defineEndpoint({
  method: 'POST',
  path: '/alerts/:alertId/unmute',
  params: alertParams,
  output: alertSummarySchema,
});

/** Validates the window of a replay. */
const replayWindowSchema = z.object({
  from: z.number(),
  to: z.number(),
  /** The time between evaluations; the spec's `every` when left out. */
  step: durationSchema.optional(),
});

/** Validates a period of time. */
const periodSchema = z.object({ from: z.number(), to: z.number() });

/** Validates one series of a replay. */
const replaySeriesSchema = z.object({
  key: z.string(),
  labels: labelsSchema,
  /** The value at each evaluation; empty when the points were left out for size. */
  points: z.array(z.object({ at: z.number(), value: z.number().nullable() })),
  /** When it fired; `ongoing` when it still fired at the end of the window. */
  firing: z.array(periodSchema.extend({ ongoing: z.boolean() })),
  firings: z.int(),
  firingMs: z.number(),
  /** When the condition held, but not for long enough to fire, with the extreme value. */
  tooShort: z.array(periodSchema.extend({ peak: z.number().nullable() })),
});

/** Validates a replay: how the alert would have behaved, or why it cannot be replayed. */
export const alertReplaySchema = z.discriminatedUnion('replayable', [
  z.object({ replayable: z.literal(false), reason: z.string() }),
  z.object({
    replayable: z.literal(true),
    from: z.number(),
    to: z.number(),
    stepMs: z.number(),
    series: z.array(replaySeriesSchema),
    /** Whether series were dropped over the cap. */
    truncated: z.boolean(),
  }),
]);

/** A replay. */
export type AlertReplay = z.infer<typeof alertReplaySchema>;

/** Replays a spec, such as a draft, over a past window. */
export const replayAlertSpecEndpoint = defineEndpoint({
  method: 'POST',
  path: '/alerts/replay',
  body: replayWindowSchema.extend({ spec: z.unknown() }),
  output: alertReplaySchema,
});

/** Replays a saved version over a past window. Viewers replay the versions ever active. */
export const replayAlertVersionEndpoint = defineEndpoint({
  method: 'POST',
  path: '/alerts/:alertId/versions/:version/replay',
  params: alertParams.extend({ version: z.string().regex(/^[1-9]\d{0,5}$/) }),
  body: replayWindowSchema,
  output: alertReplaySchema,
});

/** Validates the alert settings: how many alerts may be active per connector. */
export const alertSettingsSchema = z.strictObject({
  maxActivePerConnector: z.int().min(1).max(10_000).default(50),
});

/** The alert settings. */
export type AlertSettings = z.infer<typeof alertSettingsSchema>;

/** The alert settings, for admins. */
export const getAlertSettingsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/settings/alerts',
  output: alertSettingsSchema,
});

/** Saves the alert settings. */
export const saveAlertSettingsEndpoint = defineEndpoint({
  method: 'PUT',
  path: '/settings/alerts',
  body: alertSettingsSchema,
  output: alertSettingsSchema,
});
