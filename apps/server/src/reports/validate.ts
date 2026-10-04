/**
 * Validates a report spec: the schema first, then the dashboard's own checks on its panels over
 * its latest period, then what only a report has: its time zone, its channels and the pinned
 * dashboards it links to. Issues come back with paths, as a dashboard's do.
 */
import {
  dashboardOfReport,
  type ReportSpec,
  reportSpecSchema,
  resolvePeriod,
} from '@quanthea/shared';
import type { ConnectorLookup } from '../dashboards/check-queries.ts';
import { pathOf, type SpecIssue } from '../dashboards/issues.ts';
import { checkTimezone, validateSpec } from '../dashboards/validate.ts';

/** What validation needs besides the spec. */
export interface ReportValidationContext {
  /** Finds a connector by name. */
  readonly lookup: ConnectorLookup;
  /** The current instant, for the latest period. */
  readonly now: number;
  /** Whether a notification channel exists; channels are not checked without it. */
  readonly channelExists?: ((channelId: string) => boolean) | undefined;
  /** Whether a dashboard is pinned; links are not checked without it. */
  readonly dashboardPinned?: ((dashboardId: string) => boolean) | undefined;
}

/** The outcome of validation: a clean spec, or the issues. */
export type ReportValidation =
  | { readonly ok: true; readonly spec: ReportSpec }
  | { readonly ok: false; readonly issues: readonly SpecIssue[] };

/**
 * Where a dashboard issue is in a report: the time range is the report's period, and its time
 * zone the schedule's.
 *
 * @param issue - The dashboard's issue.
 * @returns The report's issue.
 */
function reportIssue(issue: SpecIssue): SpecIssue {
  if (issue.path === 'time') return { ...issue, path: 'period' };
  if (issue.path === 'timezone') return { ...issue, path: 'schedule.timezone' };
  return issue;
}

/**
 * Checks the channels and the linked dashboards exist.
 *
 * @param spec - The spec.
 * @param context - How to look them up.
 * @returns The issues.
 */
function checkTargets(spec: ReportSpec, context: ReportValidationContext): SpecIssue[] {
  const { channelExists, dashboardPinned } = context;
  const channels = spec.delivery.channels.flatMap((id, index) =>
    !channelExists || channelExists(id)
      ? []
      : [{ path: `delivery.channels[${index}]`, message: `No notification channel ${id}.` }],
  );
  const links = spec.seeAlso.flatMap(({ dashboardId }, index) =>
    !dashboardPinned || dashboardPinned(dashboardId)
      ? []
      : [{ path: `seeAlso[${index}].dashboardId`, message: `No pinned dashboard ${dashboardId}.` }],
  );
  return [...channels, ...links];
}

/**
 * Validates a report spec.
 *
 * @param input - The spec, as JSON.
 * @param context - The connectors, the current instant, and how to find channels and dashboards.
 * @returns The parsed spec with its grid repaired, or every issue found.
 */
export function validateReportSpec(
  input: unknown,
  context: ReportValidationContext,
): ReportValidation {
  const parsed = reportSpecSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      path: pathOf(issue.path),
      message: issue.message,
    }));
    return { ok: false, issues };
  }
  const spec = parsed.data;
  const zone = checkTimezone(spec.schedule.timezone).map(reportIssue);
  if (zone.length > 0) return { ok: false, issues: zone };
  const period = resolvePeriod(spec.period, context.now, spec.schedule.timezone);
  const dashboard = validateSpec(dashboardOfReport(spec, period), context);
  const issues = [
    ...(dashboard.ok ? [] : dashboard.issues.map(reportIssue)),
    ...checkTargets(spec, context),
  ];
  if (!dashboard.ok || issues.length > 0) return { ok: false, issues };
  return { ok: true, spec: { ...spec, panels: dashboard.spec.panels } };
}
