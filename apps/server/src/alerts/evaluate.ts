/**
 * Evaluates one alert: runs its query over the window ending now, moves each series through the
 * state machine, saves the new states and the changes, then sends the notifications that are due.
 * No model is involved, and a mute stops the notifications only.
 */
import type { AlertSpec, Notification } from '@quanthea/shared';
import type { AlertRow } from '../db/alert-repository.ts';
import type { AlertStateRepository, EventRow, SeriesRow } from '../db/alert-state-repository.ts';
import { newId } from '../lib/ids.ts';
import type { Logger } from '../lib/logger.ts';
import { buildNotification, decideNotification, type NotifyDecision } from './notify.ts';
import { observe, type SeriesObservation, wholeAlertKey } from './observe.ts';
import { ruleOf } from './replay-core.ts';
import { type AlertQueryDependencies, runAlertQuery } from './run-query.ts';
import { type SeriesState, stepSeries, type Transition } from './state.ts';
import { windowAt } from './validate.ts';

/** Sends a notification to channels. The notification channels provide it. */
export type Notify = (
  channelIds: readonly string[],
  notification: Notification,
) => Promise<unknown>;

/** What evaluating an alert needs. */
export interface EvaluationDependencies extends AlertQueryDependencies {
  /** The state of alerts. */
  readonly states: Pick<AlertStateRepository, 'series' | 'saveEvaluation'>;
  /** Sends notifications. */
  readonly notify: Notify;
  /** Reports failures. */
  readonly logger: Logger;
  /** The link to an alert. */
  readonly alertUrl: (alertId: string) => string;
}

/** An alert being evaluated with its active version. */
export interface EvaluatedAlert {
  /** The alert. */
  readonly alert: AlertRow;
  /** Its active version's spec. */
  readonly spec: AlertSpec;
}

/** One series to move: its key, what was observed, and its row before. */
interface SeriesInput {
  /** The series key. */
  readonly key: string;
  /** What the evaluation observed of it. */
  readonly observed: SeriesObservation;
  /** Its row before, if any. */
  readonly previous: SeriesRow | undefined;
}

/** The evaluation's time, whether the alert is muted, and the link to it. */
interface EvaluationContext {
  /** When the evaluation ran. */
  readonly now: number;
  /** Whether the alert is muted. */
  readonly muted: boolean;
  /** The link to the alert. */
  readonly url: string;
}

/** What one series came to in an evaluation. */
interface SeriesOutcome {
  /** The series key. */
  readonly key: string;
  /** Its new row, or `null` when it is gone. */
  readonly row: SeriesRow | null;
  /** The change of state, if any. */
  readonly event: (EventRow & { readonly id: string }) | null;
  /** The notification to send, if any. */
  readonly notification: Notification | null;
}

/**
 * Whether an alert is muted at an instant.
 *
 * @param alert - The alert.
 * @param now - The instant.
 * @returns `true` while a mute holds.
 */
export function isMuted(alert: AlertRow, now: number): boolean {
  if (alert.mutedAt === null) return false;
  return alert.mutedUntil === null || alert.mutedUntil > now;
}

/**
 * Moves a series through the state machine. The series of the alert as a whole leaves a threshold
 * alert once it is ok again: there it only stands for a failed query.
 *
 * @param spec - The spec.
 * @param input - The series.
 * @param now - When.
 * @returns The new state, or `null` when the series is gone, and the change of state.
 */
function stepOf(spec: AlertSpec, input: SeriesInput, now: number) {
  const step = stepSeries(input.previous, input.observed.observation, ruleOf(spec), now);
  const whole = input.key === wholeAlertKey && spec.condition.kind === 'threshold';
  return whole && step.next?.state === 'ok' ? { ...step, next: null } : step;
}

/**
 * The stored row of a series after an evaluation.
 *
 * @param input - The series.
 * @param next - Its new state.
 * @param decision - Its notification decision.
 * @param now - When.
 * @returns The row.
 */
function rowOf(
  input: SeriesInput,
  next: SeriesState,
  decision: NotifyDecision,
  now: number,
): SeriesRow {
  const notifiedAt = decision.event ? now : (input.previous?.notifiedAt ?? null);
  const { key, observed } = input;
  const { announced } = decision;
  return { ...next, key, labels: observed.labels, evaluatedAt: now, notifiedAt, announced };
}

/**
 * The stored change of state of a series.
 *
 * @param subject - The alert, for its active version.
 * @param input - The series.
 * @param transition - The change.
 * @param decision - Its notification decision.
 * @returns The event.
 */
function eventOf(
  subject: EvaluatedAlert,
  input: SeriesInput,
  transition: Transition,
  decision: NotifyDecision,
): EventRow & { readonly id: string } {
  return {
    ...transition,
    id: newId(),
    version: subject.alert.activeVersion ?? 0,
    seriesKey: input.key,
    labels: input.observed.labels,
    notified: decision.event !== null,
  };
}

/**
 * Builds the notification a decision asks for.
 *
 * @param subject - The alert and its spec.
 * @param input - The series.
 * @param state - Its state after the evaluation, or before when it is gone: its value and since.
 * @param decision - The decision.
 * @param context - The time and the link.
 * @returns The notification, or `null` when none is due.
 */
function notificationOf(
  subject: EvaluatedAlert,
  input: SeriesInput,
  state: Pick<SeriesState, 'value' | 'since'> | undefined,
  decision: NotifyDecision,
  context: EvaluationContext,
): Notification | null {
  if (decision.event === null) return null;
  const { alert, spec } = subject;
  const { now, url } = context;
  const series = {
    key: input.key,
    labels: input.observed.labels,
    value: state?.value ?? null,
    since: state?.since ?? now,
  };
  const about = { alertId: alert.id, version: alert.activeVersion ?? 0, spec, series, url };
  return buildNotification(about, decision.event, now);
}

/**
 * Moves one series and decides its notification.
 *
 * @param subject - The alert and its spec.
 * @param input - The series.
 * @param context - The evaluation's time, mute and link.
 * @returns The new row, the change of state and the notification.
 */
function advance(
  subject: EvaluatedAlert,
  input: SeriesInput,
  context: EvaluationContext,
): SeriesOutcome {
  const { next, transition } = stepOf(subject.spec, input, context.now);
  const decision = decideNotification(subject.spec.notify, {
    announced: input.previous?.announced ?? false,
    notifiedAt: input.previous?.notifiedAt ?? null,
    muted: context.muted,
    now: context.now,
    state: next?.state ?? null,
  });
  return {
    key: input.key,
    row: next && rowOf(input, next, decision, context.now),
    event: transition && eventOf(subject, input, transition, decision),
    notification: notificationOf(subject, input, next ?? input.previous, decision, context),
  };
}

/**
 * Sends notifications, one at a time. A failure is logged and does not stop the others.
 *
 * @param dependencies - The sender and the logger.
 * @param subject - The alert and its spec.
 * @param notifications - The notifications.
 */
async function send(
  dependencies: Pick<EvaluationDependencies, 'notify' | 'logger'>,
  subject: EvaluatedAlert,
  notifications: readonly Notification[],
): Promise<void> {
  if (subject.spec.channels.length === 0) return;
  for (const notification of notifications) {
    try {
      await dependencies.notify(subject.spec.channels, notification);
    } catch (error) {
      const alertId = subject.alert.id;
      dependencies.logger.error('an alert notification failed', { alertId, error: String(error) });
    }
  }
}

/**
 * Logs a query that started failing, once per failure.
 *
 * @param logger - The logger.
 * @param alertId - The alert.
 * @param events - The changes of state of the evaluation.
 */
function reportErrors(logger: Logger, alertId: string, events: readonly EventRow[]): void {
  for (const event of events)
    if (event.to === 'error')
      logger.warn('an alert query failed', { alertId, error: event.message });
}

/**
 * Saves what an evaluation did to the series.
 *
 * @param dependencies - The state store.
 * @param alertId - The alert.
 * @param outcomes - Each series' outcome.
 * @param now - When the evaluation ran.
 */
function save(
  dependencies: Pick<EvaluationDependencies, 'states'>,
  alertId: string,
  outcomes: readonly SeriesOutcome[],
  now: number,
): void {
  dependencies.states.saveEvaluation(alertId, {
    evaluatedAt: now,
    series: outcomes.flatMap((each) => (each.row ? [each.row] : [])),
    removed: outcomes.flatMap((each) => (each.row ? [] : [each.key])),
    events: outcomes.flatMap((each) => (each.event ? [each.event] : [])),
  });
}

/**
 * Evaluates one alert at an instant.
 *
 * @param dependencies - The query engine, the state store, the sender, the logger and the link.
 * @param subject - The alert and its active spec.
 * @param now - The instant.
 */
export async function evaluateAlert(
  dependencies: EvaluationDependencies,
  subject: EvaluatedAlert,
  now: number,
): Promise<void> {
  const { alert, spec } = subject;
  const outcome = await runAlertQuery(dependencies, spec, windowAt(spec, now));
  const previous = new Map(dependencies.states.series(alert.id).map((row) => [row.key, row]));
  const known = new Map([...previous].map(([key, row]) => [key, row.labels]));
  const context = { now, muted: isMuted(alert, now), url: dependencies.alertUrl(alert.id) };
  const outcomes = [...observe(spec, outcome, known).series].map(([key, observed]) =>
    advance(subject, { key, observed, previous: previous.get(key) }, context),
  );
  save(dependencies, alert.id, outcomes, now);
  reportErrors(
    dependencies.logger,
    alert.id,
    outcomes.flatMap((each) => (each.event ? [each.event] : [])),
  );
  await send(
    dependencies,
    subject,
    outcomes.flatMap((each) => each.notification ?? []),
  );
}
