/**
 * The messages a report sends, built by our code from a run: `report.ready` with the headline
 * numbers and their change, and `report.failed` with the reason. No template is written by anyone,
 * so nothing but the run's facts goes in, and each channel's recipe escapes them.
 */
import {
  type Headline,
  type PeriodRange,
  periodLabel,
  type ReportEvent,
  type ReportNotification,
  type ReportSpec,
} from '@quanthea/shared';
import { dashboardPath, type ReportsContext, runPath } from './context.ts';

/** What a message is about. */
export interface MessageSubject {
  /** The report. */
  readonly reportId: string;
  /** The version that ran. */
  readonly version: number;
  /** Its spec. */
  readonly spec: ReportSpec;
  /** The run; `null` for a test, which stores none. */
  readonly runId: string | null;
  /** The period. */
  readonly period: PeriodRange;
  /** The comparison period, or `null`. */
  readonly comparison: PeriodRange | null;
  /** The headline numbers; none for a failure. */
  readonly headlines: readonly Headline[];
  /** Whether it is a test. */
  readonly test: boolean;
}

/**
 * The links to the pinned dashboards, opened on the period. One unpinned since is left out.
 *
 * @param context - The service context.
 * @param spec - The spec.
 * @param period - The period.
 * @returns Each dashboard's id, label and path.
 */
export function seeAlsoLinks(context: ReportsContext, spec: ReportSpec, period: PeriodRange) {
  return spec.seeAlso.flatMap(({ dashboardId, label }) => {
    const dashboard = context.dashboard(dashboardId);
    if (!dashboard?.pinnedVersionId) return [];
    const path = dashboardPath(dashboardId, period);
    return [{ dashboardId, label: label ?? dashboard.title, path }];
  });
}

/**
 * Builds a report's message.
 *
 * @param context - The service context, for the dashboards and the public URL.
 * @param subject - The report, the run, the periods and the numbers.
 * @param event - Ready or failed.
 * @param reason - Why it failed, for `report.failed`.
 * @returns The notification.
 */
export function reportMessage(
  context: ReportsContext,
  subject: MessageSubject,
  event: ReportEvent,
  reason: string | null,
): ReportNotification {
  const { spec, period, comparison, reportId, runId } = subject;
  const zone = spec.schedule.timezone;
  const label = periodLabel(spec.period, period, zone);
  const path =
    runId === null ? `/reports/${encodeURIComponent(reportId)}` : runPath(reportId, runId);
  const links = seeAlsoLinks(context, spec, period);
  return {
    event,
    test: subject.test,
    report: { id: reportId, title: spec.title, version: subject.version },
    run: {
      id: runId,
      period: label,
      from: new Date(period.from).toISOString(),
      to: new Date(period.to).toISOString(),
      comparison: comparison === null ? null : periodLabel(spec.period, comparison, zone),
    },
    title: `${spec.delivery.title ?? spec.title} · ${label}`,
    lines: subject.headlines.map((each) => ({
      label: each.title,
      value: each.text,
      change: each.change?.text ?? null,
    })),
    link: { label: 'Open the report', url: `${context.origin}${path}` },
    seeAlso: links.map((link) => ({ label: link.label, url: `${context.origin}${link.path}` })),
    reason,
    at: new Date(context.now()).toISOString(),
  };
}
