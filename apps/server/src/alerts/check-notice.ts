/**
 * Whether an alert can be checked, and what it says about it. An alert whose query failed
 * {@link failuresBeforeError} evaluations in a row is in error: it sends `alert.error` once, and
 * `alert.recovered` once an evaluation runs its query again. One failure alone is a blip and says
 * nothing. A mute, or the setting being off, holds the messages back, not the record; an alert
 * still in error when the mute ends says so then. The message is quanthea's own, not the alert's
 * template, which is about values.
 */
import type { AlertSpec, MessageTemplate, Notification } from '@quanthea/shared';
import type { CheckEventRow, CheckState } from '../db/alert-state-repository.ts';

/** How many evaluations in a row must fail before an alert is in error. */
export const failuresBeforeError = 2;

/** The longest reason a message quotes, in characters. */
const maxReasonLength = 300;

/** What one evaluation says about checking the alert. */
export interface CheckFacts {
  /** Why the query failed, or `null` when the evaluation ran it. */
  readonly failure: string | null;
  /** Whether messages are held back: the alert is muted, or the setting is off. */
  readonly quiet: boolean;
  /** When the evaluation ran. */
  readonly now: number;
}

/** The event a check sends. */
export type CheckEvent = 'alert.error' | 'alert.recovered';

/** What one evaluation does to whether the alert can be checked. */
export interface CheckDecision {
  /** The new state. */
  readonly state: CheckState;
  /** The event to send, if any. */
  readonly event: CheckEvent | null;
  /** What to record in the timeline, if anything. */
  readonly record: Omit<CheckEventRow, 'notified'> | null;
}

/**
 * Decides after a failed evaluation: in error past the failures allowed, announced once.
 *
 * @param previous - The state before.
 * @param facts - The evaluation, with why its query failed.
 * @param failure - Why its query failed.
 * @returns The decision.
 */
function failedCheck(previous: CheckState, facts: CheckFacts, failure: string): CheckDecision {
  const failures = previous.failures + 1;
  const entered = previous.errorSince === null && failures >= failuresBeforeError;
  const errorSince = entered ? facts.now : previous.errorSince;
  const announce = errorSince !== null && !previous.notified && !facts.quiet;
  const event = announce ? 'alert.error' : null;
  const record =
    entered || announce ? { kind: 'error' as const, at: facts.now, reason: failure } : null;
  return {
    state: { failures, errorSince, notified: previous.notified || announce },
    event,
    record,
  };
}

/**
 * Decides after an evaluation that ran its query: an alert in error recovers, and says so when
 * it had said it was in error.
 *
 * @param previous - The state before.
 * @param facts - The evaluation.
 * @returns The decision.
 */
function passedCheck(previous: CheckState, facts: CheckFacts): CheckDecision {
  const state = { failures: 0, errorSince: null, notified: false };
  if (previous.errorSince === null) return { state, event: null, record: null };
  const event = previous.notified && !facts.quiet ? 'alert.recovered' : null;
  return { state, event, record: { kind: 'recovered', at: facts.now, reason: null } };
}

/**
 * Decides what an evaluation does to whether the alert can be checked.
 *
 * @param previous - The state before.
 * @param facts - Why the query failed, if it did, whether messages are held back, and when.
 * @returns The new state, the event to send and what to record.
 */
export function decideCheck(previous: CheckState, facts: CheckFacts): CheckDecision {
  return facts.failure === null
    ? passedCheck(previous, facts)
    : failedCheck(previous, facts, facts.failure);
}

/** The fixed messages: the alert's title and why it cannot be checked fill them. */
const checkTemplates: Readonly<Record<CheckEvent, MessageTemplate>> = {
  'alert.error': {
    title: '{alert} cannot be checked',
    body: '{alert} cannot be checked: {reason}',
    fields: [],
  },
  'alert.recovered': {
    title: '{alert} can be checked again',
    body: '{alert} can be checked again.',
    fields: [],
  },
};

/** What a check notification is about. */
export interface CheckSubject {
  /** The alert. */
  readonly alertId: string;
  /** The active version. */
  readonly version: number;
  /** The active version's spec. */
  readonly spec: AlertSpec;
  /** The link to the alert. */
  readonly url: string;
}

/**
 * Builds a check notification: the fixed message, filled with the alert's title and the reason.
 *
 * @param subject - The alert, its version, spec and link.
 * @param event - Whether it cannot be checked, or can be again.
 * @param reason - Why the query failed, in words that quote no secret; `null` on recovery.
 * @param now - When.
 * @returns The notification, about the alert as a whole.
 */
export function checkNotification(
  subject: CheckSubject,
  event: CheckEvent,
  reason: string | null,
  now: number,
): Notification {
  const { spec, url } = subject;
  const why = reason === null ? {} : { reason: reason.slice(0, maxReasonLength) };
  return {
    event,
    alert: {
      id: subject.alertId,
      title: spec.title,
      version: subject.version,
      severity: spec.severity,
      url,
    },
    series: { key: '', labels: {} },
    template: checkTemplates[event],
    values: { alert: spec.title, severity: spec.severity, link: url, ...why },
    at: new Date(now).toISOString(),
  };
}
