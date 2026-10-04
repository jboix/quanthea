/**
 * Validates a dashboard spec: the schema first, then the checks the schema cannot express. Issues
 * come back with paths, so the model can repair them and the UI can point at them. Overlapping
 * panels are repaired rather than refused.
 */
import {
  type DashboardSpec,
  dashboardSpecSchema,
  type ResolvedTimeRange,
  resolveTimeRange,
} from '@quanthea/shared';
import { checkOption } from './check-option.ts';
import { type ConnectorLookup, checkQueries } from './check-queries.ts';
import { checkReferences } from './check-references.ts';
import { packGrid } from './grid.ts';
import { pathOf, type SpecIssue } from './issues.ts';

/** What validation needs besides the spec. */
export interface ValidationContext {
  /** Finds a connector by name. */
  readonly lookup: ConnectorLookup;
  /** The current instant, for relative default times. */
  readonly now: number;
}

/** The outcome of validation: a clean spec, or the issues. */
export type ValidationResult =
  | { readonly ok: true; readonly spec: DashboardSpec }
  | { readonly ok: false; readonly issues: readonly SpecIssue[] };

/**
 * Checks the time zone is one the runtime knows.
 *
 * @param timezone - The IANA zone, if any.
 * @returns The issue, if any.
 */
export function checkTimezone(timezone: string | undefined): SpecIssue[] {
  if (timezone === undefined) return [];
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
    return [];
  } catch {
    return [{ path: 'timezone', message: `Unknown time zone "${timezone}".` }];
  }
}

/**
 * Checks the default time range runs forwards.
 *
 * @param timeRange - The resolved range.
 * @returns The issue, if any.
 */
function checkDirection(timeRange: ResolvedTimeRange): SpecIssue[] {
  return timeRange.from < timeRange.to
    ? []
    : [{ path: 'time', message: 'The time range ends before it starts.' }];
}

/**
 * Checks every chart option.
 *
 * @param spec - The spec.
 * @returns The issues.
 */
function checkOptions(spec: DashboardSpec): SpecIssue[] {
  return spec.panels.flatMap((panel, index) =>
    panel.view.kind === 'chart'
      ? checkOption(panel.view.option, `panels[${index}].view.option`)
      : [],
  );
}

/**
 * Validates a spec.
 *
 * @param input - The spec, as JSON.
 * @param context - The connectors and the current instant.
 * @returns The parsed spec with its grid repaired, or every issue found.
 */
export function validateSpec(input: unknown, context: ValidationContext): ValidationResult {
  const parsed = dashboardSpecSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      path: pathOf(issue.path),
      message: issue.message,
    }));
    return { ok: false, issues };
  }
  const spec = parsed.data;
  const timeRange = resolveTimeRange(spec.time, context.now);
  const issues = [
    ...checkTimezone(spec.timezone),
    ...checkDirection(timeRange),
    ...checkReferences(spec),
    ...checkOptions(spec),
    ...checkQueries(spec, context.lookup, timeRange),
  ];
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, spec: { ...spec, panels: packGrid(spec.panels) } };
}
