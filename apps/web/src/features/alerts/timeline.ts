/**
 * "What happened" on an alert's page: its series' changes of state, whether each notified, the
 * times it could not be checked and could be again, and what people did to it (activations,
 * deactivations, mutes and unmutes), the latest first.
 */
import type { AlertDetail } from '@quanthea/shared';
import { muteEnd, type StateTone } from './state-text.ts';
import { seriesName, stateWords, valueText } from './words.ts';

/** One line of the timeline. */
export interface TimelineEntry {
  /** A key unique within the timeline. */
  readonly key: string;
  /** When. */
  readonly at: number;
  /** What happened. */
  readonly text: string;
  /** The colour of its dot. */
  readonly tone: StateTone;
}

/** A change of state. */
type AlertEvent = AlertDetail['events'][number];

/** A time it went into error, or could be checked again. */
type AlertCheck = AlertDetail['checks'][number];

/** Something someone did. */
type AlertActivity = AlertDetail['activity'][number];

/** The colour of each state a series moves to. */
const toneOf: Readonly<Record<AlertEvent['to'], StateTone>> = {
  firing: 'danger',
  error: 'danger',
  pending: 'pending',
  ok: 'ok',
  no_data: 'neutral',
};

/**
 * What a change of state did, in words.
 *
 * @param event - The change.
 * @returns Such as `firing`, `resolved` or `query failed: timeout`.
 */
function changeWords(event: AlertEvent): string {
  if (event.to === 'ok') return event.from === 'firing' ? 'resolved' : 'ok again';
  if (event.to === 'error')
    return event.message ? `query failing: ${event.message}` : 'query failing';
  return stateWords[event.to];
}

/**
 * One change of state as a line.
 *
 * @param event - The change.
 * @param detail - The alert, for its format and channels.
 * @param index - Its place, for the key.
 * @returns The line.
 */
function eventEntry(event: AlertEvent, detail: AlertDetail, index: number): TimelineEntry {
  const value = event.value === null ? '' : ` (${valueText(event.value, detail.format)})`;
  const notified = notifiedWords(event.notified, detail);
  const text = `${seriesName(event.labels)} ${changeWords(event)}${value}${notified}`;
  return { key: `event-${index}`, at: event.at, text, tone: toneOf[event.to] };
}

/**
 * The channels a line says were notified, when it notified.
 *
 * @param notified - Whether it notified.
 * @param detail - The alert, for its channels.
 * @returns Such as ` · notified Ops Slack`, or nothing.
 */
function notifiedWords(notified: boolean, detail: AlertDetail): string {
  const channels = detail.channels.map((channel) => channel.name).join(', ');
  return notified ? ` · notified ${channels}`.trimEnd() : '';
}

/**
 * A time it went into error, or could be checked again, as a line.
 *
 * @param check - What happened.
 * @param detail - The alert, for its channels.
 * @param index - Its place, for the key.
 * @returns The line.
 */
function checkEntry(check: AlertCheck, detail: AlertDetail, index: number): TimelineEntry {
  const error = check.kind === 'error';
  const reason = check.reason ? `: ${check.reason}` : '';
  const words = error ? `Cannot be checked${reason}` : 'Can be checked again';
  const text = `${words}${notifiedWords(check.notified, detail)}`;
  return { key: `check-${index}`, at: check.at, text, tone: error ? 'danger' : 'ok' };
}

/**
 * Something someone did as a line.
 *
 * @param activity - The change.
 * @param detail - The alert, for the notes of its versions.
 * @param now - The current time, for a mute's end.
 * @param index - Its place, for the key.
 * @returns The line.
 */
function activityEntry(
  activity: AlertActivity,
  detail: AlertDetail,
  now: number,
  index: number,
): TimelineEntry {
  const by = `by ${activity.by}`;
  const note = detail.versions.find((each) => each.version === activity.version)?.note;
  const noteText = note ? `: ${note}` : '';
  const words: Record<AlertActivity['action'], string> = {
    activate: `v${activity.version ?? '?'} activated ${by}${noteText}`,
    deactivate: `Deactivated ${by}`,
    mute: `Muted ${by} ${muteEnd(activity.until, now)}`,
    unmute: `Unmuted ${by}`,
  };
  return {
    key: `activity-${index}`,
    at: activity.at,
    text: words[activity.action],
    tone: 'neutral',
  };
}

/**
 * The timeline, the latest first.
 *
 * @param detail - The alert.
 * @param now - The current time.
 * @returns The lines.
 */
export function timeline(detail: AlertDetail, now: number): TimelineEntry[] {
  const events = detail.events.map((event, index) => eventEntry(event, detail, index));
  const checks = detail.checks.map((check, index) => checkEntry(check, detail, index));
  const activity = detail.activity.map((each, index) => activityEntry(each, detail, now, index));
  return [...events, ...checks, ...activity].sort((a, b) => b.at - a.at);
}
