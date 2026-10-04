/**
 * When a series notifies, and what the notification says. A series announces that it fires once,
 * again every `repeatEvery` while it keeps firing, and that it resolved when it had announced
 * firing. A muted alert sends nothing; a series that fires when the mute ends announces then.
 */
import {
  type AlertSpec,
  type AlertState,
  createFormatter,
  durationMs,
  type Notification,
  type NotificationEvent,
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
  /** When the evaluation ran. */
  readonly now: number;
}

/** What a series does: the event it sends, if any, and whether it has announced firing after. */
export interface NotifyDecision {
  /** The event to send. */
  readonly event: Extract<NotificationEvent, 'alert.firing' | 'alert.resolved'> | null;
  /** Whether the series has announced firing after this evaluation. */
  readonly announced: boolean;
}

/**
 * Decides whether a series notifies.
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
  if (facts.state !== 'ok' && facts.state !== null) return { event: null, announced };
  const resolved = announced && notify.onResolved && !facts.muted;
  return { event: resolved ? 'alert.resolved' : null, announced: false };
}

/**
 * Decides whether a firing series notifies: the first time, then on repeat, never while muted.
 *
 * @param notify - The spec's `notify`.
 * @param facts - The series and the alert now.
 * @returns The event and the announced flag.
 */
function firingDecision(notify: AlertSpec['notify'], facts: NotifyFacts): NotifyDecision {
  const { announced } = facts;
  if (facts.muted) return { event: null, announced };
  if (!announced) return { event: 'alert.firing', announced: true };
  return { event: repeatDue(notify, facts) ? 'alert.firing' : null, announced };
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

/**
 * Writes a value as the spec's format asks, or with four significant digits.
 *
 * @param spec - The spec.
 * @param value - The value.
 * @returns The text; empty without a value.
 */
function formatValue(spec: AlertSpec, value: number | null): string {
  if (value === null) return '';
  if (spec.value.format) return createFormatter(spec.value.format)(value);
  return new Intl.NumberFormat('en', { maximumSignificantDigits: 4 }).format(value);
}

/**
 * Writes the threshold.
 *
 * @param spec - The spec.
 * @returns Such as `above 5`, or `no data`.
 */
function thresholdText(spec: AlertSpec): string {
  const { condition } = spec;
  if (condition.kind === 'no_data') return 'no data';
  return `${condition.op} ${formatValue(spec, condition.value)}`;
}

/**
 * Writes an instant in the spec's time zone.
 *
 * @param spec - The spec.
 * @param at - The instant.
 * @returns Such as `4 Oct, 12:04 UTC`.
 */
function timeText(spec: AlertSpec, at: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: spec.timezone ?? 'UTC',
    timeZoneName: 'short',
  }).format(at);
}

/**
 * Builds a notification. The template is the spec's; the values come from the series.
 *
 * @param subject - The alert, its version and spec, the series and the link.
 * @param event - What happened.
 * @param now - When.
 * @returns The notification.
 */
export function buildNotification(
  subject: NotificationSubject,
  event: NotifyDecision['event'] & string,
  now: number,
): Notification {
  const { spec, series } = subject;
  const labels = Object.entries(series.labels).map(([name, value]) => `${name}=${value}`);
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
    template: spec.message,
    values: {
      alert: spec.title,
      series: labels.length > 0 ? labels.join(', ') : 'all',
      value: formatValue(spec, series.value),
      threshold: thresholdText(spec),
      duration: spec.condition.for,
      since: timeText(spec, series.since),
      severity: spec.severity,
      link: subject.url,
    },
    at: new Date(now).toISOString(),
  };
}
