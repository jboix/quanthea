/**
 * Whether an alert can be checked, and what it says about it. An alert whose query failed
 * {@link failuresBeforeError} evaluations in a row is in error: it sends `alert.error` once, and
 * `alert.recovered` once an evaluation runs its query again. One failure alone is a blip and says
 * nothing. A mute, or the setting being off, holds the messages back, not the record; an alert
 * still in error when the mute ends says so then. Quiet hours hold the messages back too, and a
 * recovery that was owed waits for them to end. The message is quanthea's own, not the alert's
 * template, which is about values.
 */
import type { AlertSpec, MessageTemplate, Notification } from '@quanthea/shared';
import type { CheckEventRow, CheckState } from '../db/alert-state-repository.ts';
import { holdingFrom } from './notify.ts';

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
  /** Whether messages wait: quiet hours hold. */
  readonly held: boolean;
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
  /** What to record in the timeline, if anything; `quiet` when quiet hours held its message. */
  readonly record: Omit<CheckEventRow, 'notified'> | null;
}

/**
 * Whether an alert in error owes its `alert.error`: not announced yet, and not muted.
 *
 * @param errorSince - Since when it is in error, or `null` when it is not.
 * @param previous - The state before.
 * @param facts - The evaluation.
 * @returns `true` when the message is due, quiet hours aside.
 */
function owesError(errorSince: number | null, previous: CheckState, facts: CheckFacts): boolean {
  return errorSince !== null && !previous.notified && !facts.quiet;
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
  const owed = owesError(errorSince, previous, facts);
  const announce = owed && !facts.held;
  const row = { kind: 'error' as const, at: facts.now, reason: failure, quiet: owed && facts.held };
  return {
    state: { failures, errorSince, notified: previous.notified || announce },
    event: announce ? 'alert.error' : null,
    record: entered || announce ? row : null,
  };
}

/**
 * Decides after an evaluation that ran its query: an alert in error recovers, and says so when
 * it had said it was in error. During quiet hours that message waits: the alert stays announced
 * and says so once they end. The recovery is recorded once, when it happens: the message sent
 * later adds no row, as a series' late message adds none.
 *
 * @param previous - The state before.
 * @param facts - The evaluation.
 * @returns The decision.
 */
function passedCheck(previous: CheckState, facts: CheckFacts): CheckDecision {
  const owed = previous.notified && !facts.quiet;
  const waits = owed && facts.held;
  const event = owed && !waits ? 'alert.recovered' : null;
  const recorded = previous.errorSince !== null;
  return {
    state: { failures: 0, errorSince: null, notified: waits },
    event,
    record: recorded ? { kind: 'recovered', at: facts.now, reason: null, quiet: waits } : null,
  };
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

/**
 * Whether an alert still cannot be checked as it announced, with nothing sent about it at this
 * evaluation: its `alert.error` is then said again to the channels that must hear it. A mute, the
 * setting and quiet hours hold that back as they hold a message.
 *
 * @param decision - What the evaluation decided.
 * @param facts - The evaluation.
 * @returns `true` when the failed check is kept alive.
 */
export function keepsError(decision: CheckDecision, facts: CheckFacts): boolean {
  const { errorSince, notified } = decision.state;
  if (decision.event !== null || facts.quiet || facts.held) return false;
  return errorSince !== null && notified;
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
 * @param since - Since when the alert cannot be checked; now when left out.
 * @returns The notification, about the alert as a whole. An `alert.error` says until when it
 *   holds, as a firing does.
 */
export function checkNotification(
  subject: CheckSubject,
  event: CheckEvent,
  reason: string | null,
  now: number,
  since: number = now,
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
    ...(event === 'alert.error' ? { firing: holdingFrom(spec, since, now) } : {}),
    at: new Date(now).toISOString(),
  };
}
