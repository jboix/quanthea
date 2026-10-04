/**
 * The contract between reports and notification channels. A report's message is built by our code
 * from a run's numbers: a title with the period, the headline numbers with their change, a link to
 * the run and links to dashboards. No template is written by anyone; each channel kind's recipe
 * escapes every text for its service, as it escapes an alert's values.
 */
import { z } from 'zod';
import { notificationEvents } from './notifications.ts';

/** What a report notification reports: a run is ready, or failed after its retries. */
export const reportEvents = ['report.ready', 'report.failed'] as const;

/** A report notification event. */
export type ReportEvent = (typeof reportEvents)[number];

/** Every event a channel sends, about alerts and reports. */
export const channelEvents = [...notificationEvents, ...reportEvents] as const;

/** An event a channel sends. */
export type ChannelEvent = (typeof channelEvents)[number];

/** Validates a link the message carries. */
const linkSchema = z.strictObject({
  /** What it says. */
  label: z.string().min(1).max(150),
  /** Where it goes: quanthea's public URL, or a path without one. */
  url: z.string().min(1).max(2000),
});

/** Validates a headline number as the message lists it. */
const lineSchema = z.strictObject({
  /** The panel's title. */
  label: z.string().min(1).max(200),
  /** The number, formatted. */
  value: z.string().max(200),
  /** Its change, such as `▲ 6.2%`; `null` without a comparison. */
  change: z.string().max(60).nullable(),
});

/** Validates a report notification. */
export const reportNotificationSchema = z.strictObject({
  event: z.enum(reportEvents),
  /** Whether someone sent it to try the message out. */
  test: z.boolean(),
  report: z.strictObject({
    id: z.string().min(1),
    title: z.string().min(1),
    version: z.int().positive(),
  }),
  /** The run; its id is `null` for a test, which stores no run. */
  run: z.strictObject({
    id: z.string().min(1).nullable(),
    /** The period in words, such as `week 40, 29 Sep – 5 Oct`. */
    period: z.string().min(1),
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
    /** The comparison period in words, or `null` without one. */
    comparison: z.string().nullable(),
  }),
  /** The message's title, such as `Weekly sales · week 40, 29 Sep – 5 Oct`. */
  title: z.string().min(1).max(300),
  /** The headline numbers, in the report's order. */
  lines: z.array(lineSchema).max(8),
  /** The run's page. */
  link: linkSchema,
  /** The dashboards to open on the period. */
  seeAlso: z.array(linkSchema).max(5),
  /** Why the run failed, for `report.failed`: quanthea's own words, which quote no secret. */
  reason: z.string().max(300).nullable(),
  at: z.iso.datetime({ offset: true }),
});

/** A report notification, as handed to the channels. */
export type ReportNotification = z.output<typeof reportNotificationSchema>;
