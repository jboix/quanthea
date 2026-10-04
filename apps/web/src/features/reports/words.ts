/**
 * Reports in words: the schedule and the period (`Mondays 08:00 · the previous week`), the next
 * run, a run's title from its period's name (`Week 40 · 29 Sep – 5 Oct`), and the line that says
 * when it ran, where it went, or why it failed.
 */
import {
  calendarParts,
  type ReportPeriod,
  type ReportRunDetail,
  type ReportRunSummary,
  type ReportSchedule,
} from '@quanthea/shared';

/** What each period covers, in words. */
const periodWords: Readonly<Record<ReportPeriod, string>> = {
  previous_day: 'yesterday',
  previous_week: 'the previous week',
  previous_month: 'the previous month',
  week_to_date: 'this week so far',
};

/**
 * A day of the month as an ordinal.
 *
 * @param day - From 1 to 31.
 * @returns Such as `1st`, `22nd` or `31st`.
 */
function ordinal(day: number): string {
  const teen = day % 100 >= 11 && day % 100 <= 13;
  const suffix = teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[day % 10] ?? 'th');
  return `${day}${suffix}`;
}

/**
 * When a report runs, in words.
 *
 * @param schedule - The schedule.
 * @returns Such as `Daily 07:00`, `Mondays 08:00` or `Monthly, the 1st 08:00`.
 */
export function scheduleWords(schedule: ReportSchedule): string {
  if (schedule.every === 'day') return `Daily ${schedule.at}`;
  if (schedule.every === 'month') return `Monthly, the ${ordinal(schedule.day)} ${schedule.at}`;
  const weekday = `${schedule.weekday[0]?.toUpperCase()}${schedule.weekday.slice(1)}`;
  return `${weekday}s ${schedule.at}`;
}

/**
 * The schedule and the period a report covers, in words.
 *
 * @param schedule - The schedule.
 * @param period - The period.
 * @returns Such as `Mondays 08:00 · the previous week`.
 */
export function scheduleLine(schedule: ReportSchedule, period: ReportPeriod): string {
  return `${scheduleWords(schedule)} · ${periodWords[period]}`;
}

/**
 * An instant as a day and a time with its weekday.
 *
 * @param at - Epoch milliseconds.
 * @param timeZone - The time zone.
 * @returns Such as `Mon 6 Oct 08:00`.
 */
export function weekdayTime(at: number, timeZone: string): string {
  const { weekday, day, month, time } = calendarParts(at, timeZone);
  return `${weekday} ${day} ${month} ${time}`;
}

/**
 * When a report runs next, in words.
 *
 * @param nextRunAt - When, or `null` while it is not active.
 * @param timeZone - The schedule's time zone.
 * @param draft - Whether it has never been active.
 * @returns Such as `next Mon 13 Oct 08:00`, `not active` or `deactivated`.
 */
export function nextRunWords(nextRunAt: number | null, timeZone: string, draft: boolean): string {
  if (nextRunAt !== null) return `next ${weekdayTime(nextRunAt, timeZone)}`;
  return draft ? 'not active' : 'deactivated';
}

/**
 * A run's title, from its period's name.
 *
 * @param label - Such as `week 40, 29 Sep – 5 Oct`.
 * @returns Such as `Week 40 · 29 Sep – 5 Oct`.
 */
export function runTitle(label: string): string {
  const titled = `${label[0]?.toUpperCase() ?? ''}${label.slice(1)}`;
  return titled.replace(', ', ' · ');
}

/**
 * The channels a run's message reached, by name.
 *
 * @param run - The run.
 * @returns Such as `sent to #sales and #finance`, or nothing when it went nowhere.
 */
function sentWords(run: Pick<ReportRunDetail, 'delivery' | 'sentAt'>): string[] {
  if (run.sentAt === null || !run.delivery || run.delivery.length === 0) return [];
  const names = run.delivery.map((each) => each.channelName ?? 'a deleted channel');
  const failed = run.delivery.filter((each) => !each.ok).length;
  const list =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  return [`sent to ${list}${failed > 0 ? ` (${failed} failed)` : ''}`];
}

/** What the line under a run's title reads of the run. */
type RanRun = Pick<
  ReportRunDetail,
  'status' | 'ranAt' | 'createdAt' | 'error' | 'attempts' | 'retryAt' | 'delivery' | 'sentAt'
> &
  Pick<ReportRunDetail, 'startedBy'>;

/**
 * A run that has not succeeded, in words: why it failed and after how many attempts, or that it
 * runs and when it tries again.
 *
 * @param run - The run.
 * @param when - When it last ran, in words.
 * @param timeZone - The schedule's time zone.
 * @returns The line.
 */
function unfinishedLine(run: RanRun, when: string, timeZone: string): string {
  const tries = `${run.attempts} ${run.attempts === 1 ? 'attempt' : 'attempts'}`;
  if (run.status === 'failed') return `Failed ${when} after ${tries}: ${run.error ?? 'no reason'}`;
  if (!run.error) return `Running since ${when}`;
  const retry = run.retryAt === null ? '' : `, tries again ${weekdayTime(run.retryAt, timeZone)}`;
  return `Running since ${when} · last attempt failed: ${run.error}${retry}`;
}

/**
 * The line under a run's title: when it ran and where it went, that opening it runs no query, or
 * why it failed and after how many attempts, or that it is still running.
 *
 * @param run - The run.
 * @param timeZone - The schedule's time zone.
 * @returns The line.
 */
export function ranLine(run: RanRun, timeZone: string): string {
  const when = weekdayTime(run.ranAt ?? run.createdAt, timeZone);
  if (run.status !== 'ok') return unfinishedLine(run, when, timeZone);
  const by = run.startedBy === null ? '' : ` by ${run.startedBy}`;
  const parts = [`Ran ${when}${by}`, ...sentWords(run), 'frozen: opening it runs no query'];
  return parts.join(' · ');
}

/**
 * The last run of a report as the list shows it: its first headline number, or that it failed.
 *
 * @param run - The latest run, if any.
 * @returns The caption, the number and its change, or the failure.
 */
export function lastRunWords(run: ReportRunSummary | null) {
  if (!run) return { kind: 'none' as const, text: 'No run yet' };
  if (run.status === 'failed') return { kind: 'failed' as const, text: 'Last run failed' };
  if (run.status === 'running') return { kind: 'none' as const, text: 'Running' };
  const [first] = run.headlines;
  if (!first) return { kind: 'none' as const, text: run.period.label };
  const caption = `${first.title}, ${run.period.label.split(',')[0] ?? ''}`;
  return { kind: 'value' as const, caption, text: first.text, change: first.change };
}
