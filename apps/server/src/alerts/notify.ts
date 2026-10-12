/**
 * When a series notifies, and what the notification says. A series announces that it fires once,
 * again every `repeatEvery` while it keeps firing, and that it resolved when it had announced
 * firing. A muted alert sends nothing; a series that fires when the mute ends announces then.
 * Quiet hours hold messages back the same way, and a resolution waits for them to end, so a
 * channel that opened an incident closes it. A firing announced later than it began says since
 * when.
 */
import {
  type AlertSpec,
  type AlertState,
  durationMs,
  type MessageTemplate,
  type Notification,
  type NotificationEvent,
  notificationValues,
} from '@quanthea/shared';

/** What decides whether a series notifies. */
export interface NotifyFacts {
  /** Its state after the evaluation; `null` when it is gone. */
  readonly state: AlertState | null;
  /** Whether it announced firing and has not announced resolving since. */
  readonly announced: boolean;
  /** When it last notified. */
  readonly notifiedAt: number | null;
  /** Whether the alert is muted now. */
  readonly muted: boolean;
  /** Whether quiet hours hold now. */
  readonly quiet: boolean;
  /** When it entered its state; the evaluation's time when it is gone. */
  readonly since: number;
  /** When the evaluation ran. */
  readonly now: number;
}

/** What a series does: the event it sends, if any, and whether it has announced firing after. */
export interface NotifyDecision {
  /** The event to send. */
  readonly event: Extract<NotificationEvent, 'alert.firing' | 'alert.resolved'> | null;
  /** Whether the series has announced firing after this evaluation. */
  readonly announced: boolean;
  /** Whether it announces a firing that began before this evaluation. */
  readonly late: boolean;
  /** Whether quiet hours held back a message it would have sent. */
  readonly held: boolean;
}

/**
 * A series that sends nothing.
 *
 * @param announced - Whether it has announced firing after.
 * @returns The decision.
 */
function silent(announced: boolean): NotifyDecision {
  return { event: null, announced, late: false, held: false };
}

/**
 * Decides whether a series notifies. During quiet hours a resolution it owes waits: the series
 * stays announced, and resolves once they end.
 *
 * @param notify - The spec's `notify`.
 * @param facts - The series and the alert now.
 * @returns The event and the announced flag.
 */
export function decideNotification(
  notify: AlertSpec['notify'],
  facts: NotifyFacts,
): NotifyDecision {
  if (facts.state === 'firing') return firingDecision(notify, facts);
  const { announced } = facts;
  if (facts.state !== 'ok' && facts.state !== null) return silent(announced);
  const resolved = announced && notify.onResolved && !facts.muted;
  if (resolved && facts.quiet) return { ...silent(true), held: true };
  return { ...silent(false), event: resolved ? 'alert.resolved' : null };
}

/**
 * Decides whether a firing series notifies: the first time, then on repeat, never while muted or
 * during quiet hours.
 *
 * @param notify - The spec's `notify`.
 * @param facts - The series and the alert now.
 * @returns The event and the announced flag.
 */
function firingDecision(notify: AlertSpec['notify'], facts: NotifyFacts): NotifyDecision {
  const { announced } = facts;
  const due = !announced || repeatDue(notify, facts);
  if (facts.muted || !due) return silent(announced);
  if (facts.quiet) return { ...silent(announced), held: true };
  return { ...silent(true), event: 'alert.firing', late: !announced && facts.since < facts.now };
}

/**
 * Whether a firing series is due to notify again.
 *
 * @param notify - The spec's `notify`.
 * @param facts - The series and the alert now.
 * @returns `true` when `repeatEvery` has passed since it last notified.
 */
function repeatDue(notify: AlertSpec['notify'], facts: NotifyFacts): boolean {
  if (notify.repeatEvery === undefined) return false;
  return facts.now - (facts.notifiedAt ?? 0) >= durationMs(notify.repeatEvery);
}

/** What a notification is about. */
export interface NotificationSubject {
  /** The alert. */
  readonly alertId: string;
  /** The active version. */
  readonly version: number;
  /** The active version's spec. */
  readonly spec: AlertSpec;
  /** The series. */
  readonly series: {
    readonly key: string;
    readonly labels: Readonly<Record<string, string>>;
    readonly value: number | null;
    readonly since: number;
  };
  /** The link to the alert: quanthea's public URL, or a path without one. */
  readonly url: string;
}

/** The most fields a message template holds. */
const maxFields = 8;

/**
 * A template that says since when the series fires: itself when it names `{since}` or has no
 * room for a field, else with the field `Firing since`.
 *
 * @param template - The spec's template.
 * @returns The template.
 */
function sayingSince(template: MessageTemplate): MessageTemplate {
  const texts = [template.title, template.body, ...template.fields.map((field) => field.value)];
  const says = texts.some((text) => text.includes('{since}'));
  if (says || template.fields.length >= maxFields) return template;
  return { ...template, fields: [...template.fields, { label: 'Firing since', value: '{since}' }] };
}

/**
 * Builds a notification. The template is the spec's; the values come from the series.
 *
 * @param subject - The alert, its version and spec, the series and the link.
 * @param event - What happened.
 * @param now - When.
 * @param late - Whether it announces a firing that began earlier, and so says since when.
 * @returns The notification.
 */
export function buildNotification(
  subject: NotificationSubject,
  event: NotifyDecision['event'] & string,
  now: number,
  late = false,
): Notification {
  const { spec, series } = subject;
  return {
    event,
    alert: {
      id: subject.alertId,
      title: spec.title,
      version: subject.version,
      severity: spec.severity,
      url: subject.url,
    },
    series: { key: series.key, labels: { ...series.labels } },
    template: late ? sayingSince(spec.message) : spec.message,
    values: notificationValues(spec, series, subject.url),
    at: new Date(now).toISOString(),
  };
}
