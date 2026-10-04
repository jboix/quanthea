/**
 * Runs a report's panels over a period through the dashboards' panel run path, with the
 * variables' defaults, the guardrails, row limits and timeouts every panel run has, and the period
 * as its absolute time range; then over the comparison period. Any failing query fails the run,
 * with a reason in quanthea's own words that quotes no secret: the query engine's safe message.
 */
import {
  dashboardOfReport,
  type Headline,
  headlineOf,
  type PanelRun,
  type PeriodRange,
  type ReportSpec,
} from '@quanthea/shared';
import { type RunnerDependencies, runPanel } from '../dashboards/run-panel.ts';
import { AppError } from '../lib/errors.ts';

/** The longest reason a run keeps, in characters. */
const maxReasonLength = 300;

/** Each panel's run, by panel id. */
export type PanelRuns = Record<string, PanelRun>;

/** A run's results, frozen, and why it failed, if it did. */
export interface Execution {
  /** Each panel's run over the period; a panel that could not run is left out. */
  readonly panels: PanelRuns;
  /** Each panel's run over the comparison period; `null` without one, or after a failure. */
  readonly comparisonPanels: PanelRuns | null;
  /** The headline numbers, in the spec's order; none after a failure. */
  readonly headlines: Headline[];
  /** Why the run failed, in words that quote no secret; `null` when every query ran. */
  readonly failure: string | null;
}

/**
 * Why a panel's run failed, if a query or a set of markers failed.
 *
 * @param run - The panel's run.
 * @returns The engine's safe message, or `null` when every query ran.
 */
function failureOf(run: PanelRun): string | null {
  const query = run.queries.find((each) => each.error !== null);
  if (query?.error) return query.error.message;
  return run.markers.find((each) => each.error !== null)?.error?.message ?? null;
}

/**
 * Runs one panel, turning a refusal into a failure.
 *
 * @param runner - The connectors, the executor and the clock.
 * @param spec - The dashboard the report runs.
 * @param panelId - The panel.
 * @returns The run, or why it could not run.
 * @throws {unknown} Anything that is not an application error.
 */
async function runOne(
  runner: RunnerDependencies,
  spec: ReturnType<typeof dashboardOfReport>,
  panelId: string,
): Promise<{ run: PanelRun | null; failure: string | null }> {
  try {
    const run = await runPanel(runner, spec, panelId, { variables: {}, time: spec.time });
    return { run, failure: failureOf(run) };
  } catch (error) {
    if (error instanceof AppError) return { run: null, failure: error.message };
    throw error;
  }
}

/**
 * Runs every panel over one period, at once.
 *
 * @param runner - The connectors, the executor and the clock.
 * @param spec - The report spec.
 * @param period - The period.
 * @returns Each panel's run, or the first failure.
 */
async function runPeriod(
  runner: RunnerDependencies,
  spec: ReportSpec,
  period: PeriodRange,
): Promise<{ panels: PanelRuns; failure: string | null }> {
  const dashboard = dashboardOfReport(spec, period);
  const outcomes = await Promise.all(
    spec.panels.map(async (panel) => ({ panel, ...(await runOne(runner, dashboard, panel.id)) })),
  );
  const failed = outcomes.find((outcome) => outcome.failure !== null);
  const failure = failed ? `Panel "${failed.panel.title}": ${failed.failure}` : null;
  const panels = Object.fromEntries(
    outcomes.flatMap(({ panel, run }) => (run ? [[panel.id, run] as const] : [])),
  );
  return { panels, failure };
}

/**
 * Reads the headline numbers from the results.
 *
 * @param spec - The report spec.
 * @param panels - Each panel's run over the period.
 * @param before - Each panel's run over the comparison period, or `null`.
 * @returns The headlines, in the spec's order.
 */
function headlinesOf(spec: ReportSpec, panels: PanelRuns, before: PanelRuns | null): Headline[] {
  return spec.summaryPanels.flatMap((panelId) => {
    const panel = spec.panels.find((each) => each.id === panelId);
    if (panel?.view.kind !== 'stat') return [];
    const stat = { id: panel.id, title: panel.title, view: panel.view };
    const earlier = before === null ? null : (before[panelId]?.queries ?? []);
    return [headlineOf(stat, panels[panelId]?.queries ?? [], earlier, spec.schedule.timezone)];
  });
}

/**
 * Runs a report spec over a period, then over the comparison period.
 *
 * @param runner - The connectors, the executor and the clock.
 * @param spec - The report spec.
 * @param period - The period.
 * @param comparison - The comparison period, or `null` without one.
 * @returns The results, and why the run failed, if it did.
 */
export async function executeReport(
  runner: RunnerDependencies,
  spec: ReportSpec,
  period: PeriodRange,
  comparison: PeriodRange | null,
): Promise<Execution> {
  const current = await runPeriod(runner, spec, period);
  const failed = { panels: current.panels, comparisonPanels: null, headlines: [] };
  if (current.failure !== null)
    return { ...failed, failure: current.failure.slice(0, maxReasonLength) };
  const before = comparison === null ? null : await runPeriod(runner, spec, comparison);
  if (before?.failure)
    return { ...failed, failure: `The period before: ${before.failure}`.slice(0, maxReasonLength) };
  const comparisonPanels = before === null ? null : before.panels;
  const headlines = headlinesOf(spec, current.panels, comparisonPanels);
  return { panels: current.panels, comparisonPanels, headlines, failure: null };
}
