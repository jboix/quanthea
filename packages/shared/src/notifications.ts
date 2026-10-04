/**
 * The contract between alerts and notification channels. An alert carries a message template the
 * agent wrote once, with named placeholders only; a notification carries that template and the
 * values to fill it with. Each channel kind's recipe fills and escapes the values for its service,
 * so text from the data never becomes markup, links or mentions.
 */
import { z } from 'zod';

/** The placeholders a message template may use, each written as `{name}`. */
export const messagePlaceholders = [
  'alert',
  'series',
  'value',
  'threshold',
  'duration',
  'since',
  'severity',
  'link',
] as const;

/** A placeholder's name. */
export type MessagePlaceholder = (typeof messagePlaceholders)[number];

/** Validates a template text: plain words and known `{placeholders}`, nothing else in braces. */
const templateText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((text) => unknownPlaceholders(text).length === 0, {
      message: `Use only these placeholders: ${messagePlaceholders.map((name) => `{${name}}`).join(', ')}.`,
    });

/** Validates a message template: a title, a short body, and labelled fields. */
export const messageTemplateSchema = z.strictObject({
  title: templateText(150),
  body: templateText(1000),
  fields: z
    .array(z.strictObject({ label: z.string().min(1).max(60), value: templateText(200) }))
    .max(8)
    .default([]),
});

/** A message template, as parsed. */
export type MessageTemplate = z.output<typeof messageTemplateSchema>;

/** What a notification reports. */
export const notificationEvents = ['alert.firing', 'alert.resolved', 'alert.test'] as const;

/** A notification event. */
export type NotificationEvent = (typeof notificationEvents)[number];

/** Validates a notification: the event, the alert, its series and the values for the template. */
export const notificationSchema = z.strictObject({
  event: z.enum(notificationEvents),
  alert: z.strictObject({
    id: z.string().min(1),
    title: z.string().min(1),
    version: z.number().int().positive(),
    severity: z.enum(['critical', 'warning', 'info']),
    url: z.string().min(1),
  }),
  series: z.strictObject({ key: z.string(), labels: z.record(z.string(), z.string()) }),
  template: messageTemplateSchema,
  values: z.partialRecord(z.enum(messagePlaceholders), z.string()),
  at: z.iso.datetime({ offset: true }),
});

/** A notification, as handed to the channels. */
export type Notification = z.output<typeof notificationSchema>;

/**
 * The placeholders a text names that are not known.
 *
 * @param text - The template text.
 * @returns The unknown names, in order of appearance.
 */
export function unknownPlaceholders(text: string): string[] {
  const known = new Set<string>(messagePlaceholders);
  return [...text.matchAll(/\{([^{}]*)\}/g)]
    .map((match) => match[1] ?? '')
    .filter((name) => !known.has(name));
}
