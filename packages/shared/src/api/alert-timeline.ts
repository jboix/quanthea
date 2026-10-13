/**
 * The lists of an alert's page that grow without limit, a page at a time: what happened to it and
 * the messages sent about it. An alert's detail carries the first page of each. A page is read by
 * a cursor that names the last entry of the page before, so it does not move when new entries
 * arrive.
 */
import { z } from 'zod';
import { notificationEvents } from '../notifications.ts';
import { alertStates, seriesLabelsSchema } from './alert-states.ts';
import { defineEndpoint } from './contract.ts';

/** How many entries a page of an alert's lists holds, when the reader asks for no other size. */
export const alertPageSize = 10;

/** Validates a change of state, for the timeline. */
const alertEventSchema = z.object({
  version: z.int(),
  seriesKey: z.string(),
  labels: seriesLabelsSchema,
  from: z.enum(alertStates),
  to: z.enum(alertStates),
  at: z.number(),
  value: z.number().nullable(),
  /** Why the query failed, for a change to `error`. */
  message: z.string().nullable(),
  /** Whether the change sent a notification. */
  notified: z.boolean(),
  /** Whether quiet hours held back the notification it would have sent. */
  quiet: z.boolean(),
});

/** Validates a time an alert went into error, or could be checked again, for the timeline. */
const alertCheckEventSchema = z.object({
  /** `error`: its query failed several evaluations in a row; `recovered`: it ran again. */
  kind: z.enum(['error', 'recovered']),
  at: z.number(),
  /** Why the query failed, for `error`. */
  reason: z.string().nullable(),
  /** Whether it sent a notification. */
  notified: z.boolean(),
  /** Whether quiet hours held back the notification it would have sent. */
  quiet: z.boolean(),
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

/** What every entry of the timeline has besides its own fields: an id unique in the timeline. */
const entryId = { id: z.string() };

/**
 * Validates one entry of the timeline: a change of state (`event`), a time the alert could not be
 * checked or could be again (`check`), or something someone did to it (`activity`).
 */
const alertTimelineEntrySchema = z.discriminatedUnion('type', [
  alertEventSchema.extend({ type: z.literal('event'), ...entryId }),
  alertCheckEventSchema.extend({ type: z.literal('check'), ...entryId }),
  alertActivitySchema.extend({ type: z.literal('activity'), ...entryId }),
]);

/** One entry of the timeline. */
export type AlertTimelineEntry = z.infer<typeof alertTimelineEntrySchema>;

/** What every page says of its place in the whole list. */
const pagePlace = {
  /** The cursor of the page of older entries; `null` at the end of the list. */
  older: z.string().nullable(),
  /** How many entries the list holds in all. */
  total: z.int(),
  /** How many entries of the list are newer than the page's first. */
  offset: z.int(),
};

/** Validates a page of the timeline, the latest first. */
export const alertTimelinePageSchema = z.object({
  entries: z.array(alertTimelineEntrySchema),
  ...pagePlace,
});

/** A page of the timeline. */
export type AlertTimelinePage = z.infer<typeof alertTimelinePageSchema>;

/** Validates a message sent about an alert: the channel by name, never its target. */
const alertSendSchema = z.object({
  id: z.string(),
  channel: z.string(),
  kind: z.string(),
  event: z.enum(notificationEvents),
  seriesKey: z.string(),
  at: z.number(),
  ok: z.boolean(),
});

/** Validates a page of the messages sent about an alert, the latest first. */
export const alertSendsPageSchema = z.object({ sends: z.array(alertSendSchema), ...pagePlace });

/** A page of the messages sent about an alert. */
export type AlertSendsPage = z.infer<typeof alertSendsPageSchema>;

/** The path parameter of one alert. */
const alertParams = z.object({ alertId: z.string().min(1).max(64) });

/** Validates which page to read: the entries older than a cursor, the latest when left out. */
const pageQuery = z.object({
  /** The `older` cursor of the page before: a time and an id. */
  before: z
    .string()
    .regex(/^\d{1,16}:\S{1,64}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(50).default(alertPageSize),
});

/** Reads a page of what happened to an alert. Whoever reads the alert reads it. */
export const getAlertTimelineEndpoint = defineEndpoint({
  method: 'GET',
  path: '/alerts/:alertId/timeline',
  params: alertParams,
  query: pageQuery,
  output: alertTimelinePageSchema,
});

/** Reads a page of the messages sent about an alert. Whoever reads the alert reads it. */
export const listAlertSendsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/alerts/:alertId/sends',
  params: alertParams,
  query: pageQuery,
  output: alertSendsPageSchema,
});
