/**
 * The status of each alert in the list, the filters and their counts, and the sections the list
 * shows: Firing, Pending, OK (muted alerts among them), then drafts and deactivated alerts.
 */
import type { AlertListItem, AlertSummary } from '@quanthea/shared';
import { conditionWords, seriesName } from './words.ts';

/** Where an alert stands, for the list. */
export type AlertStatus =
  | 'firing'
  | 'pending'
  | 'ok'
  | 'no_data'
  | 'error'
  | 'muted'
  | 'draft'
  | 'deactivated';

/** The filters of the list. */
export const alertFilters = ['all', 'firing', 'pending', 'ok', 'muted', 'drafts'] as const;

/** A filter of the list. */
export type AlertFilter = (typeof alertFilters)[number];

/** The sections of the list, in order. */
const sectionLabels = {
  firing: 'Firing',
  pending: 'Pending',
  ok: 'OK',
  drafts: 'Drafts',
  deactivated: 'Deactivated',
} as const;

/** A section of the list. */
export type SectionId = keyof typeof sectionLabels;

/** One section and its alerts. */
export interface AlertSection {
  /** The section. */
  readonly id: SectionId;
  /** Its heading. */
  readonly label: string;
  /** Its alerts, in order. */
  readonly alerts: readonly AlertListItem[];
}

/**
 * The state the alert's series are in, the worst first.
 *
 * @param states - How many series are in each state.
 * @returns The worst state with a series, else `ok`.
 */
function worstState(states: AlertSummary['states']): AlertStatus {
  const order = ['firing', 'pending', 'error', 'no_data'] as const;
  return order.find((state) => states[state] > 0) ?? 'ok';
}

/**
 * Where an alert stands: a draft, deactivated, muted, or the worst state of its series.
 *
 * @param alert - The alert.
 * @returns The status.
 */
export function alertStatus(alert: AlertSummary): AlertStatus {
  if (alert.activeVersion === null) return 'draft';
  if (alert.deactivated) return 'deactivated';
  if (alert.muted) return 'muted';
  return worstState(alert.states);
}

/** The section of each status. */
const sectionOf: Readonly<Record<AlertStatus, SectionId>> = {
  firing: 'firing',
  pending: 'pending',
  ok: 'ok',
  no_data: 'ok',
  error: 'ok',
  muted: 'ok',
  draft: 'drafts',
  deactivated: 'deactivated',
};

/**
 * Whether an alert passes a filter.
 *
 * @param status - The alert's status.
 * @param filter - The filter.
 * @returns `true` when the list shows it.
 */
function passes(status: AlertStatus, filter: AlertFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'muted') return status === 'muted';
  if (filter === 'ok') return sectionOf[status] === 'ok' && status !== 'muted';
  return sectionOf[status] === filter;
}

/**
 * How many alerts each filter shows.
 *
 * @param alerts - The alerts.
 * @returns The count of each filter.
 */
export function filterCounts(alerts: readonly AlertSummary[]): Record<AlertFilter, number> {
  const statuses = alerts.map(alertStatus);
  const count = (filter: AlertFilter) => statuses.filter((each) => passes(each, filter)).length;
  return Object.fromEntries(alertFilters.map((filter) => [filter, count(filter)])) as Record<
    AlertFilter,
    number
  >;
}

/**
 * Whether an alert matches the words searched: its title, condition or worst series.
 *
 * @param alert - The alert.
 * @param words - The words, lower case.
 * @returns `true` when every word is found.
 */
function matches(alert: AlertListItem, words: readonly string[]): boolean {
  const lead = alert.lead ? seriesName(alert.lead.labels) : '';
  const text = [alert.title, conditionWords(alert.condition, alert.format), lead]
    .join(' ')
    .toLowerCase();
  return words.every((word) => text.includes(word));
}

/**
 * Orders a section: firing and pending alerts the latest first, the others by title.
 *
 * @param id - The section.
 * @param alerts - Its alerts.
 * @returns The alerts in order.
 */
function ordered(id: SectionId, alerts: AlertListItem[]): AlertListItem[] {
  if (id !== 'firing' && id !== 'pending')
    return alerts.sort((a, b) => a.title.localeCompare(b.title));
  return alerts.sort((a, b) => (b.lead?.since ?? 0) - (a.lead?.since ?? 0));
}

/**
 * The sections the list shows for a filter and a search, leaving out the empty ones.
 *
 * @param alerts - Every alert.
 * @param filter - The filter.
 * @param search - The words searched.
 * @returns The sections, in order.
 */
export function alertSections(
  alerts: readonly AlertListItem[],
  filter: AlertFilter,
  search: string,
): AlertSection[] {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = alerts.filter(
    (alert) => passes(alertStatus(alert), filter) && matches(alert, words),
  );
  return Object.entries(sectionLabels).flatMap(([id, label]) => {
    const section = id as SectionId;
    const inSection = shown.filter((alert) => sectionOf[alertStatus(alert)] === section);
    return inSection.length === 0
      ? []
      : [{ id: section, label, alerts: ordered(section, inSection) }];
  });
}

/**
 * How many alerts fire now: evaluated, with a series firing, muted or not.
 *
 * @param alerts - The alerts.
 * @returns The count.
 */
export function firingCount(alerts: readonly AlertSummary[]): number {
  return alerts.filter(
    (alert) => alert.activeVersion !== null && !alert.deactivated && alert.states.firing > 0,
  ).length;
}

/**
 * Reads a filter from the URL.
 *
 * @param value - The `show` parameter.
 * @returns The filter; `all` for anything else.
 */
export function filterFrom(value: string | null): AlertFilter {
  return alertFilters.find((filter) => filter === value) ?? 'all';
}
