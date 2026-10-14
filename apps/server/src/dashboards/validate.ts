/**
 * Validates a dashboard spec: the schema first, then the checks the schema cannot express. Issues
 * come back with paths, so the model can repair them and the UI can point at them. Overlapping
 * panels are repaired rather than refused.
 */
import {
  type DashboardSpec,
  dashboardSpecSchema,
  packGrid,
  type ResolvedTimeRange,
  resolveTimeRange,
} from '@quanthea/shared';
import { checkColors } from './check-colors.ts';
import { checkOption } from './check-option.ts';
import { type ConnectorLookup, checkQueries } from './check-queries.ts';
import { checkReferences } from './check-references.ts';
import { checkSourceOrder } from './check-source-order.ts';
import { checkSteps } from './check-steps.ts';
import { pathOf, type SpecIssue } from './issues.ts';

/** What validation needs besides the spec. */
export interface ValidationContext {
  /** Finds a connector by name. */
  readonly lookup: ConnectorLookup;
  /** The current instant, for relative default times. */
  readonly now: number;
  /**
   * Whether the spec is being written, by the agent or by a person who saves it. The rules that
   * came after dashboards were stored apply only then, so a stored version still pins, restores
   * and copies: the order of the variables a source uses, a variable with an "All" choice where
   * only one value fits, and a free colour in a chart's option.
   */
  readonly writing?: boolean | undefined;
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
 * Checks every chart: its option, and the steps only a gauge takes.
 *
 * @param spec - The spec.
 * @returns The issues.
 */
function checkOptions(spec: DashboardSpec): SpecIssue[] {
  return spec.panels.flatMap((panel, index) => {
    const path = `panels[${index}].view`;
    if (panel.view.kind !== 'chart') return [];
    return [...checkOption(panel.view.option, `${path}.option`), ...checkSteps(panel.view, path)];
  });
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
    ...checkQueries(spec, context.lookup, timeRange, context.writing === true),
    ...(context.writing ? checkSourceOrder(spec, context.lookup, timeRange) : []),
    ...(context.writing ? checkColors(spec) : []),
  ];
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, spec: { ...spec, panels: packGrid(spec.panels) } };
}
