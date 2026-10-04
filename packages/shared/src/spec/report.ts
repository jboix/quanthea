/**
 * The report spec: a dashboard spec's panels, variables and markers, run on a schedule over a
 * period with no model. It adds when it runs, the period it covers, what it compares with, the
 * pinned dashboards it points to, where it is sent and which stat panels are its headline numbers.
 * Plain JSON, like the dashboard spec it builds on: the panel schemas and checks are the
 * dashboard's own.
 */
import { z } from 'zod';
import { type PeriodRange, reportPeriodSchema } from '../reports/period.ts';
import { reportScheduleSchema } from '../reports/schedule.ts';
import { type DashboardSpec, dashboardSpecSchema } from './dashboard.ts';

/** The most headline numbers a report lists. */
export const maxSummaryPanels = 8;

/** Validates a link to a pinned dashboard, opened on the run's period. */
const seeAlsoSchema = z.strictObject({
  /** The dashboard. */
  dashboardId: z.string().min(1).max(64),
  /** What the link says; the dashboard's title when left out. */
  label: z.string().min(1).max(80).optional(),
});

/** Validates where a report is sent and the title of its message. */
const deliverySchema = z.strictObject({
  /** The notification channels, by id; none keeps the runs in quanthea only. */
  channels: z.array(z.string().min(1).max(64)).max(20).default([]),
  /** The message's title, plain text; the report's title when left out. The period follows it. */
  title: z.string().min(1).max(150).optional(),
});

/** The fields of a report spec, before the checks across them. */
const reportSpecFields = dashboardSpecSchema.omit({ time: true, timezone: true }).extend({
  /** When it runs. */
  schedule: reportScheduleSchema,
  /** The window each run covers, resolved in the schedule's time zone. */
  period: reportPeriodSchema,
  /** What each run compares with: the period before, or nothing. */
  compare: z.enum(['previous_period', 'none']).default('previous_period'),
  /** Pinned dashboards to open on the run's period. */
  seeAlso: z.array(seeAlsoSchema).max(5).default([]),
  /** Where it is sent. */
  delivery: deliverySchema.prefault({}),
  /** The stat panels whose numbers the list, the run and the message show first, in order. */
  summaryPanels: z.array(z.string().min(1).max(63)).max(maxSummaryPanels).default([]),
});

/** A report spec as its fields parse. */
type ReportSpecFields = z.output<typeof reportSpecFields>;

/**
 * The problems with the summary panels: each names a stat panel of the spec, once.
 *
 * @param spec - The parsed fields.
 * @returns Each problem's path and message.
 */
function summaryProblems(spec: ReportSpecFields) {
  const seen = new Set<string>();
  return spec.summaryPanels.flatMap((panelId, index) => {
    const panel = spec.panels.find((each) => each.id === panelId);
    const path = ['summaryPanels', index];
    if (seen.has(panelId)) return [{ path, message: 'Name each panel once.' }];
    seen.add(panelId);
    if (!panel) return [{ path, message: `No panel "${panelId}".` }];
    if (panel.view.kind !== 'stat')
      return [{ path, message: `"${panelId}" is not a stat panel; only stats are headlines.` }];
    return [];
  });
}

/**
 * The problems with the links: each dashboard once.
 *
 * @param spec - The parsed fields.
 * @returns Each problem's path and message.
 */
function seeAlsoProblems(spec: ReportSpecFields) {
  const seen = new Set<string>();
  return spec.seeAlso.flatMap(({ dashboardId }, index) => {
    if (!seen.has(dashboardId)) {
      seen.add(dashboardId);
      return [];
    }
    return [{ path: ['seeAlso', index, 'dashboardId'], message: 'Link each dashboard once.' }];
  });
}

/** Validates a report spec, version 1. */
export const reportSpecSchema = reportSpecFields.superRefine((spec, context) => {
  for (const problem of [...summaryProblems(spec), ...seeAlsoProblems(spec)])
    context.addIssue({ code: 'custom', path: problem.path, message: problem.message });
});

/** A report spec, as parsed: defaults filled in. */
export type ReportSpec = z.output<typeof reportSpecSchema>;

/**
 * The dashboard a report runs: its panels, variables and markers over a fixed range, on the
 * schedule's clock. The dashboard's checks and its panel runs take it as they take any spec.
 *
 * @param spec - The report spec.
 * @param range - The period the panels run over.
 * @returns The dashboard spec.
 */
export function dashboardOfReport(spec: ReportSpec, range: PeriodRange): DashboardSpec {
  const { specVersion, title, description, variables, panels, annotations } = spec;
  const time = { from: new Date(range.from).toISOString(), to: new Date(range.to).toISOString() };
  const described = description === undefined ? {} : { description };
  const timezone = spec.schedule.timezone;
  return { specVersion, title, ...described, timezone, time, variables, panels, annotations };
}
