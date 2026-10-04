/**
 * What every channel kind's recipe does: turn a notification into the request its service takes.
 * A recipe fills the template with values escaped for its service, so text from the data never
 * becomes markup, a link or a mention. Mentions come only from the channel, on `alert.firing` and
 * `alert.error`.
 */
import type { ChannelKind, MessageTemplate, Notification } from '@quanthea/shared';

/** The channel settings a recipe reads. The sending service opens the sealed target. */
export interface RecipeChannel {
  /** The webhook URL, or PagerDuty's routing key. */
  readonly target: string;
  /** The mentions an admin set, in the service's syntax. */
  readonly mentions: readonly string[];
}

/** What to send: where, and the JSON body. */
export interface RecipeRequest {
  /** The URL the body is posted to. */
  readonly url: string;
  /** The JSON body. */
  readonly body: unknown;
}

/** One channel kind's recipe. */
export interface ChannelRecipe {
  /** The kind it serves. */
  readonly kind: ChannelKind;
  /**
   * Builds the request for a notification.
   *
   * @param notification - The notification, with its template and values.
   * @param channel - The channel's target and mentions.
   * @returns The URL and the body. Building never sends anything.
   */
  build(notification: Notification, channel: RecipeChannel): RecipeRequest;
}

/** How a service needs text escaped: the template's own words, and the values from the data. */
export interface Escapers {
  /**
   * Escapes words the template wrote, so they stay plain text.
   *
   * @param words - The template's words between placeholders.
   * @returns The escaped words.
   */
  readonly text: (words: string) => string;
  /**
   * Escapes a value from the data, so it cannot become markup, a link or a mention.
   *
   * @param value - The value.
   * @returns The escaped value.
   */
  readonly value: (value: string) => string;
}

/** A template filled for one service. */
export interface FilledMessage {
  /** The filled title. */
  readonly title: string;
  /** The filled body. */
  readonly body: string;
  /** Each field's label and filled value. */
  readonly fields: readonly { readonly label: string; readonly value: string }[];
}

/** What a placeholder with no value becomes. */
const missingValue = '-';

/** The longest value kept before escaping, in characters. */
const maxValueLength = 500;

/**
 * Fills one template text: the words escaped as text, each `{placeholder}` replaced with its value
 * escaped as a value. The template schema refuses unknown placeholders, so every name is known.
 *
 * @param text - The template text.
 * @param values - The values by placeholder.
 * @param escapers - The service's escapers.
 * @returns The filled text.
 */
export function fillText(text: string, values: Notification['values'], escapers: Escapers): string {
  const parts = text.split(/\{([^{}]*)\}/);
  return parts
    .map((part, index) => {
      if (index % 2 === 0) return escapers.text(part);
      const value = values[part as keyof typeof values];
      return escapers.value(value ? truncate(value, maxValueLength) : missingValue);
    })
    .join('');
}

/**
 * Fills a whole template.
 *
 * @param template - The template.
 * @param values - The values by placeholder.
 * @param escapers - The service's escapers.
 * @returns The title, body and fields, filled.
 */
export function fillMessage(
  template: MessageTemplate,
  values: Notification['values'],
  escapers: Escapers,
): FilledMessage {
  return {
    title: fillText(template.title, values, escapers),
    body: fillText(template.body, values, escapers),
    fields: template.fields.map((field) => ({
      label: escapers.text(field.label),
      value: fillText(field.value, values, escapers),
    })),
  };
}

/**
 * Cuts a text to a service's limit, marking the cut.
 *
 * @param text - The text.
 * @param max - The most characters the service takes.
 * @returns The text, or its start and an ellipsis.
 */
export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** The colour of each event but firing, which takes its severity's. */
const eventColours = {
  'alert.resolved': '#2e7d32',
  'alert.recovered': '#2e7d32',
  'alert.test': '#6b7280',
  'alert.error': '#e8a317',
} as const;

/**
 * The colour of a notification: by severity while firing, green once resolved or checked again,
 * amber when it cannot be checked, grey for a test.
 *
 * @param notification - The notification.
 * @returns The colour, as `#rrggbb`.
 */
export function stateColour(notification: Notification): string {
  if (notification.event !== 'alert.firing') return eventColours[notification.event];
  const bySeverity = { critical: '#c62828', warning: '#e8a317', info: '#2a55c9' } as const;
  return bySeverity[notification.alert.severity];
}

/** Each event in words. */
const eventWords = {
  'alert.firing': 'Firing',
  'alert.resolved': 'Resolved',
  'alert.test': 'Test',
  'alert.error': 'Cannot be checked',
  'alert.recovered': 'Checked again',
} as const;

/**
 * The state of a notification in words.
 *
 * @param notification - The notification.
 * @returns Such as `Firing`, `Resolved` or `Cannot be checked`.
 */
export function stateWord(notification: Notification): string {
  return eventWords[notification.event];
}

/**
 * The context line under a message: state, severity, series and time. The series comes from the
 * data, so it is escaped as a value.
 *
 * @param notification - The notification.
 * @param escapeValue - The service's value escaper.
 * @returns The line.
 */
export function contextLine(
  notification: Notification,
  escapeValue: (value: string) => string,
): string {
  const series = notification.series.key ? escapeValue(truncate(notification.series.key, 200)) : '';
  const parts = [stateWord(notification), notification.alert.severity, series, notification.at];
  return `quanthea · ${parts.filter(Boolean).join(' · ')}`;
}

/**
 * Whether a link can go in a button: an absolute http or https URL.
 *
 * @param url - The alert's link.
 * @returns `true` when a service accepts it.
 */
export function isAbsoluteLink(url: string): boolean {
  return /^https?:\/\/[^\s]+$/i.test(url);
}

/**
 * The channel's mentions, on `alert.firing` and `alert.error` only.
 *
 * @param notification - The notification.
 * @param channel - The channel.
 * @returns The mentions to add.
 */
export function mentionsFor(notification: Notification, channel: RecipeChannel): string[] {
  const { event } = notification;
  return event === 'alert.firing' || event === 'alert.error' ? [...channel.mentions] : [];
}
