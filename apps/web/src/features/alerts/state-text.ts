/**
 * What an alert's state says: the line in the list, the pills of the alert page and the colour of
 * each.
 */
import type { AlertListItem } from '@quanthea/shared';
import { type AlertStatus, alertStatus } from './grouping.ts';
import { clockWhen, durationSince, pendingProgress, seriesName } from './words.ts';

/** The colour of a state: firing red, pending amber, ok green, the rest grey. */
export type StateTone = 'danger' | 'pending' | 'ok' | 'neutral';

/** A state in words, with its colour. */
export interface StateText {
  /** The words. */
  readonly text: string;
  /** The colour. */
  readonly tone: StateTone;
}

/**
 * Until when an alert is muted.
 *
 * @param until - The end, or `null` until someone unmutes.
 * @param now - The current time.
 * @returns Such as `until 18:00`, or `until unmuted`.
 */
export function muteEnd(until: number | null, now: number): string {
  return until === null ? 'until unmuted' : `until ${clockWhen(until, now)}`;
}

/**
 * How long the worst series has been in its state, for the states that change on their own.
 *
 * @param alert - The alert.
 * @param status - Its status.
 * @param now - The current time.
 * @returns The words and colour, or `undefined` for the other statuses.
 */
function seriesState(
  alert: AlertListItem,
  status: AlertStatus,
  now: number,
): StateText | undefined {
  const since = alert.lead?.since ?? now;
  if (status === 'firing') return { text: `Firing ${durationSince(since, now)}`, tone: 'danger' };
  if (status === 'pending') {
    const progress = pendingProgress(since, alert.condition.for, now);
    return { text: `Pending ${progress}`, tone: 'pending' };
  }
  if (status === 'error') return { text: `Failing ${durationSince(since, now)}`, tone: 'danger' };
  if (status === 'no_data')
    return { text: `No data ${durationSince(since, now)}`, tone: 'neutral' };
  return undefined;
}

/**
 * An OK alert's state: since when, or that it was never evaluated.
 *
 * @param alert - The alert.
 * @param now - The current time.
 * @returns The words and colour.
 */
function okState(alert: AlertListItem, now: number): StateText {
  if (alert.evaluatedAt === null) return { text: 'Not evaluated yet', tone: 'neutral' };
  if (!alert.lead) return { text: 'OK', tone: 'ok' };
  return { text: `OK ${durationSince(alert.lead.since, now)}`, tone: 'ok' };
}

/**
 * The state at the start of a row of the list.
 *
 * @param alert - The alert.
 * @param now - The current time.
 * @returns Such as `Firing 18 min`, `Pending 2 of 5 min`, `OK 3 d` or `Muted to 18:00`.
 */
export function rowState(alert: AlertListItem, now: number): StateText {
  const status = alertStatus(alert);
  if (status === 'draft') return { text: `Draft v${alert.latestVersion ?? 1}`, tone: 'pending' };
  if (status === 'deactivated') return { text: 'Deactivated', tone: 'neutral' };
  if (status === 'muted') {
    const until = alert.muted?.until ?? null;
    return {
      text: until === null ? 'Muted' : `Muted to ${clockWhen(until, now)}`,
      tone: 'neutral',
    };
  }
  return seriesState(alert, status, now) ?? okState(alert, now);
}

/**
 * The state pill of the alert page: the series' state with the worst series' name, whether the
 * alert is muted or not; a separate pill says so.
 *
 * @param alert - The alert.
 * @param now - The current time.
 * @returns Such as `Firing 18 min · checkout-svc`, `OK` or `Deactivated`.
 */
export function statePill(alert: AlertListItem, now: number): StateText {
  if (alert.activeVersion === null) return { text: 'Draft', tone: 'pending' };
  if (alert.deactivated) return { text: 'Deactivated', tone: 'neutral' };
  const status = alertStatus({ ...alert, muted: null });
  const state = seriesState(alert, status, now);
  if (!state) return { text: alert.evaluatedAt === null ? 'Not evaluated yet' : 'OK', tone: 'ok' };
  const name = alert.lead ? seriesName(alert.lead.labels) : '';
  const named = name === '' || name === 'all' ? state.text : `${state.text} · ${name}`;
  return { ...state, text: named };
}

/**
 * The words about the series behind a row: the worst one's name and value, and how many share its
 * state.
 *
 * @param alert - The alert.
 * @param value - The worst value, formatted.
 * @returns Such as `checkout-svc 3.4% · 1 of 4 series`, or an empty list for none.
 */
export function leadWords(alert: AlertListItem, value: string): string[] {
  const { lead } = alert;
  if (!lead || lead.state === 'ok') return [];
  const name = seriesName(lead.labels);
  const words = [name === 'all' ? value : `${name} ${value}`];
  if (alert.seriesCount > 1)
    words.push(`${alert.states[lead.state]} of ${alert.seriesCount} series`);
  return words;
}
