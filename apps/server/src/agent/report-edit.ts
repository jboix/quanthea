/**
 * What `edit_report` takes and how it lands on the draft. Its panels are a dashboard edit's, the
 * same panels of data and charts that `edit_dashboard` takes, without the time range: the period
 * is the range. Around them, the fields only a report has: when it runs, the period, what it
 * compares with, the headline numbers, the pinned dashboards it links to and where it is sent.
 * Fields left out keep the draft's.
 */
import {
  type DashboardSpec,
  dashboardOfReport,
  isTimeZone,
  type PeriodRange,
  type ReportSpec,
  reportPeriodSchema,
  reportScheduleSchema,
  resolvePeriod,
} from '@quanthea/shared';
import { z } from 'zod';
import { editRequestSchemaFor } from '../dashboards/panels/index.ts';
import type { AvailableQueries } from '../dashboards/queries/index.ts';
import type { RunContext } from './run-context.ts';

/** Validates a link to a pinned dashboard, by an id from the list. */
const seeAlsoEditSchema = z.strictObject({
  dashboardId: z.string().min(1).max(64),
  label: z.string().min(1).max(80).optional(),
});

/** The fields only a report has; each left out keeps the draft's. */
const reportFields = {
  schedule: reportScheduleSchema.optional(),
  period: reportPeriodSchema.optional(),
  compare: z.enum(['previous_period', 'none']).optional(),
  /** The stat panels whose numbers come first, by id or title. */
  summaryPanels: z.array(z.string().min(1).max(200)).max(8).optional(),
  seeAlso: z.array(seeAlsoEditSchema).max(5).optional(),
  channels: z.array(z.string().min(1).max(64)).max(20).optional(),
  /** The message's title; the report's title when left out. */
  messageTitle: z.string().min(1).max(150).optional(),
};

/**
 * The edit schema of a run: a dashboard edit's panels with the builders, saved queries and chart
 * recipes the run may use, without the time range, and the report's own fields.
 *
 * @param available - The builders and saved queries.
 * @param recipes - The chart recipes.
 * @returns The schema.
 */
export function reportEditSchemaFor(available: AvailableQueries, recipes: readonly string[]) {
  return editRequestSchemaFor(available, recipes).omit({ time: true }).extend(reportFields);
}

/** An edit of the report. */
export type ReportEdit = z.output<ReturnType<typeof reportEditSchemaFor>>;

/** The thread's latest report version. */
export interface ReportDraft {
  /** The report. */
  readonly reportId: string;
  /** The version. */
  readonly version: number;
  /** Its spec. */
  readonly spec: ReportSpec;
}

/**
 * The thread's latest report version, if it has one.
 *
 * @param context - The run.
 * @returns The draft.
 */
export function currentReport(context: RunContext): ReportDraft | undefined {
  const { reportId } = context.threads.row(context.threadId);
  if (reportId === null || !context.reports) return undefined;
  const { versions } = context.reports.get(reportId, 'editor');
  const latest = versions.reduce<(typeof versions)[number] | undefined>(
    (found, each) => (found && found.version > each.version ? found : each),
    undefined,
  );
  return latest ? { reportId, version: latest.version, spec: latest.spec } : undefined;
}

/** When a report runs and what it covers, merged from the edit and the draft. */
export interface ReportTiming {
  /** The schedule. */
  readonly schedule: ReportSpec['schedule'];
  /** The period. */
  readonly period: ReportSpec['period'];
  /** The latest period, which the panels are test-run over. */
  readonly range: PeriodRange;
}

/**
 * When the edited report runs and the latest period it covers, or what is missing.
 *
 * @param current - The draft's spec, if any.
 * @param edit - The edit.
 * @param now - The current instant.
 * @returns The timing, or the issues.
 */
export function timingOf(
  current: ReportSpec | undefined,
  edit: ReportEdit,
  now: number,
): ReportTiming | { path: string; message: string }[] {
  const schedule = edit.schedule ?? current?.schedule;
  const period = edit.period ?? current?.period;
  if (!schedule || !period)
    return [{ path: 'schedule', message: 'Set the schedule and the period on the first write.' }];
  if (!isTimeZone(schedule.timezone))
    return [{ path: 'schedule.timezone', message: `Unknown time zone "${schedule.timezone}".` }];
  return { schedule, period, range: resolvePeriod(period, now, schedule.timezone) };
}

/**
 * The dashboard the edit's panels go on: the draft's panels over the latest period, or an empty
 * one for the first write.
 *
 * @param current - The draft's spec, if any.
 * @param edit - The edit, for the first write's title.
 * @param timing - The schedule and the latest period.
 * @returns The dashboard.
 */
export function startingDashboard(
  current: ReportSpec | undefined,
  edit: ReportEdit,
  timing: ReportTiming,
): DashboardSpec | undefined {
  if (current) return dashboardOfReport({ ...current, schedule: timing.schedule }, timing.range);
  if (edit.title === undefined) return undefined;
  const time = {
    from: new Date(timing.range.from).toISOString(),
    to: new Date(timing.range.to).toISOString(),
  };
  const timezone = timing.schedule.timezone;
  const base = { specVersion: 1 as const, title: edit.title, timezone, time };
  return { ...base, variables: [], panels: [], annotations: [] };
}

/**
 * The ids of the panels a list names, by id or by title.
 *
 * @param panels - The report's panels.
 * @param names - Ids or titles.
 * @returns The ids; a name no panel has stays as it is, for validation to report.
 */
function panelIds(panels: DashboardSpec['panels'], names: readonly string[]): string[] {
  const byTitle = new Map(panels.map((panel) => [panel.title.trim().toLowerCase(), panel.id]));
  return names.map((name) =>
    panels.some((panel) => panel.id === name)
      ? name
      : (byTitle.get(name.trim().toLowerCase()) ?? name),
  );
}

/**
 * The headline panels: the edit's by id or title, else the draft's that remain.
 *
 * @param current - The draft's spec, if any.
 * @param panels - The edited panels.
 * @param edit - The edit.
 * @returns The ids.
 */
function summaryOf(
  current: ReportSpec | undefined,
  panels: DashboardSpec['panels'],
  edit: ReportEdit,
): string[] {
  if (edit.summaryPanels) return panelIds(panels, edit.summaryPanels);
  return (current?.summaryPanels ?? []).filter((id) => panels.some((panel) => panel.id === id));
}

/**
 * The report spec an edit makes: the edited dashboard's panels with the report's fields, the
 * edit's where it sets them, else the draft's.
 *
 * @param current - The draft's spec, if any.
 * @param dashboard - The dashboard the edit made, its charts completed.
 * @param edit - The edit.
 * @param timing - The schedule and the period.
 * @returns The spec, as JSON for the reports service to check.
 */
export function mergeReport(
  current: ReportSpec | undefined,
  dashboard: DashboardSpec,
  edit: ReportEdit,
  timing: ReportTiming,
): Record<string, unknown> {
  const { title, description, variables, panels, annotations } = dashboard;
  const deliveryTitle = edit.messageTitle ?? current?.delivery.title;
  return {
    specVersion: 1,
    title,
    ...(description === undefined ? {} : { description }),
    variables,
    panels,
    annotations,
    schedule: timing.schedule,
    period: timing.period,
    compare: edit.compare ?? current?.compare ?? 'previous_period',
    seeAlso: edit.seeAlso ?? current?.seeAlso ?? [],
    delivery: {
      channels: edit.channels ?? current?.delivery.channels ?? [],
      ...(deliveryTitle === undefined ? {} : { title: deliveryTitle }),
    },
    summaryPanels: summaryOf(current, panels, edit),
  };
}
