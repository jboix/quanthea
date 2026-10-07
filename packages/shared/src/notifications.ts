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

/**
 * The placeholders of a notification: the template's, and `{reason}`, why an alert cannot be
 * checked. Only the fixed messages quanthea writes about checking use `{reason}`.
 */
export const notificationPlaceholders = [...messagePlaceholders, 'reason'] as const;

/**
 * Placeholder names as a person types them, in a list.
 *
 * @param names - The names, such as `series`.
 * @returns Such as `{series}, {value}`.
 */
export function placeholderList(names: readonly string[]): string {
  return names.map((name) => `{${name}}`).join(', ');
}

/**
 * Validates a template text: plain words and known `{placeholders}`, nothing else in braces.
 *
 * @param max - The most characters.
 * @param known - The placeholders allowed.
 * @returns The schema.
 */
const templateText = (max: number, known: readonly string[]) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((text) => unknownNames(text, known).length === 0, {
      message: `Use only these placeholders: ${placeholderList(known)}.`,
    });

/**
 * Validates a template: a title, a short body, and labelled fields.
 *
 * @param known - The placeholders allowed.
 * @returns The schema.
 */
const templateSchema = (known: readonly string[]) =>
  z.strictObject({
    title: templateText(150, known),
    body: templateText(1000, known),
    fields: z
      .array(z.strictObject({ label: z.string().min(1).max(60), value: templateText(200, known) }))
      .max(8)
      .default([]),
  });

/** Validates a message template: a title, a short body, and labelled fields. */
export const messageTemplateSchema = templateSchema(messagePlaceholders);

/** A message template, as parsed. */
export type MessageTemplate = z.output<typeof messageTemplateSchema>;

/** What a notification reports. */
export const notificationEvents = [
  'alert.firing',
  'alert.resolved',
  'alert.test',
  // The alert cannot be checked: its query failed several times in a row.
  'alert.error',
  // The alert can be checked again.
  'alert.recovered',
] as const;

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
  template: templateSchema(notificationPlaceholders),
  values: z.partialRecord(z.enum(notificationPlaceholders), z.string()),
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
  return unknownNames(text, messagePlaceholders);
}

/**
 * The placeholders a text names that are not among those allowed.
 *
 * @param text - The template text.
 * @param known - The placeholders allowed.
 * @returns The unknown names, in order of appearance.
 */
function unknownNames(text: string, known: readonly string[]): string[] {
  const allowed = new Set<string>(known);
  return [...text.matchAll(/\{([^{}]*)\}/g)]
    .map((match) => match[1] ?? '')
    .filter((name) => !allowed.has(name));
}
