/**
 * The tools that read reports: the active ones with their schedule, and one run. A run's results
 * were computed by the server when it ran and are frozen, so no query runs; they are data, and
 * pass through the gate like a panel's. The headline numbers of a run are data too: a tool reads
 * them from the panels, through the gate, never from the run's summary.
 */
import {
  applyLayout,
  dashboardOfReport,
  type Panel,
  type PanelRun,
  type ReportListItem,
  type ReportRunDetail,
  type ReportRunSummary,
} from '@quanthea/shared';
import { z } from 'zod';
import { derivedFrom } from '../gate/panel-results.ts';
import { panelOf } from './pinned.ts';
import { levelOf, linkTo, type McpServices } from './services.ts';
import { defineTool, type McpTool, ToolRefusal } from './tool.ts';

/**
 * A run without its numbers: when it ran, over which period, and how it ended.
 *
 * @param services - The MCP services.
 * @param run - The run.
 * @returns Its facts.
 */
function runFacts(services: McpServices, run: ReportRunSummary) {
  return {
    runId: run.id,
    reportId: run.reportId,
    version: run.version,
    status: run.status,
    trigger: run.trigger,
    error: run.error,
    period: run.period,
    comparison: run.comparison,
    ranAt: run.ranAt === null ? null : new Date(run.ranAt).toISOString(),
    url: linkTo(services, 'reports', run.reportId, 'runs', run.id),
  };
}

/**
 * A report as a list shows it, with its latest run but none of its numbers.
 *
 * @param services - The MCP services.
 * @param report - The report.
 * @returns Its title, schedule, period and latest run.
 */
function listedReport(services: McpServices, report: ReportListItem) {
  return {
    id: report.id,
    title: report.title,
    deactivated: report.deactivated,
    schedule: report.schedule,
    period: report.period,
    nextRunAt: report.nextRunAt === null ? null : new Date(report.nextRunAt).toISOString(),
    lastRun: report.lastRun ? runFacts(services, report.lastRun) : null,
    url: linkTo(services, 'reports', report.id),
  };
}

/**
 * The tool that lists the active reports.
 *
 * @param services - The MCP services.
 * @returns The tool.
 */
function listTool(services: McpServices): McpTool {
  return defineTool({
    name: 'list_reports',
    title: 'List reports',
    description:
      'List the active reports: title, schedule, the period each run covers, when it runs next, and its latest run. Use get_report_run for a run’s panels and their results.',
    minimumRole: 'viewer',
    group: 'read',
    input: z.object({}),
    run: (_input, { principal }) => {
      const listed = services.reports.list('viewer', principal.id);
      const active = listed.filter((report) => report.activeVersion !== null);
      return { reports: active.map((report) => listedReport(services, report)) };
    },
  });
}

/**
 * The run a call is about: the one named, or the report's latest.
 *
 * @param services - The MCP services.
 * @param reportId - The report.
 * @param runId - The run, or `undefined` for the latest.
 * @returns The run with its frozen results.
 * @throws {ToolRefusal} For a report that has not run yet.
 */
function runOf(services: McpServices, reportId: string, runId?: string): ReportRunDetail {
  if (runId !== undefined) return services.reports.run(reportId, runId, 'viewer');
  const [latest] = services.reports.runs(reportId, 'viewer', { limit: 1 });
  if (!latest) throw new ToolRefusal(`Report ${reportId} has not run yet.`);
  return services.reports.run(reportId, latest.id, 'viewer');
}

/**
 * The panels a run shows: those of its version, through its layout, the hidden ones left out.
 *
 * @param run - The run.
 * @returns The panels.
 */
function shownPanels(run: ReportRunDetail): Panel[] {
  const spec = dashboardOfReport(run.spec, run.period);
  return applyLayout(spec, run.layout?.layout).spec.panels;
}

/**
 * A panel's frozen results as the gate lets them through, one per query.
 *
 * @param services - The MCP services.
 * @param panel - The panel.
 * @param frozen - What the run stored for it, if anything.
 * @param timeZone - The schedule's time zone.
 * @returns Each query with the level it is read at and what shows of its result.
 */
function frozenResults(
  services: McpServices,
  panel: Panel,
  frozen: PanelRun | undefined,
  timeZone: string,
) {
  return panel.queries.map((query) => {
    const outcome = frozen?.queries.find((each) => each.refId === query.refId);
    const shaped = outcome && {
      frames: outcome.frames,
      error: outcome.error?.message ?? null,
      derived: derivedFrom(panel, outcome),
    };
    const result = shaped
      ? services.modelView.panelResult(query.connector, shaped, timeZone)
      : { ok: false as const, error: 'The run holds no result for this query.' };
    const { refId, connector } = query;
    return { refId, connector, accessLevel: levelOf(services, connector), query, result };
  });
}

/** Validates what `get_report_run` takes. */
const runInput = z.object({
  reportId: z.string().min(1).max(64).describe('A report id.'),
  runId: z.string().min(1).max(64).optional().describe('A run id; the latest run by default.'),
  panelId: z.string().min(1).max(100).optional().describe('A panel, to read its results.'),
  period: z
    .enum(['run', 'comparison'])
    .default('run')
    .describe("The run's period, or the period it compares with."),
});

/**
 * One panel's frozen results over a side of a run.
 *
 * @param services - The MCP services.
 * @param run - The run.
 * @param input - The panel and the side.
 * @returns The panel, the window and each query's result.
 * @throws {ToolRefusal} For an unknown panel, or a comparison the run does not have.
 */
function panelRead(
  services: McpServices,
  run: ReportRunDetail,
  input: { readonly panelId: string; readonly period: 'run' | 'comparison' },
) {
  const panel = panelOf({ panels: shownPanels(run) }, input.panelId);
  const window = input.period === 'run' ? run.period : run.comparison;
  const stored = input.period === 'run' ? run.panels : run.comparisonPanels;
  if (!window || !stored) throw new ToolRefusal('This run has no results for that period.');
  return {
    panel: { id: panel.id, title: panel.title },
    read: input.period,
    time: { from: new Date(window.from).toISOString(), to: new Date(window.to).toISOString() },
    frozen: true,
    results: frozenResults(services, panel, stored[panel.id], run.spec.schedule.timezone),
  };
}

/**
 * The tool that reads one run of a report.
 *
 * @param services - The MCP services.
 * @returns The tool.
 */
function runTool(services: McpServices): McpTool {
  return defineTool({
    name: 'get_report_run',
    title: 'Read a report’s run',
    description:
      "Read one run of an active report: its period, how it ended and its panels. Pass panelId to read that panel's results as the run stored them, over the run's period or the period it compares with; no query runs. What a result shows follows the access level of its connector: 1 whether the query ran, 2 the shape, 3 a summary of each field, 4 the rows.",
    minimumRole: 'viewer',
    group: 'read',
    input: runInput,
    run: ({ reportId, runId, panelId, period }) => {
      const run = runOf(services, reportId, runId);
      const facts = { ...runFacts(services, run), title: run.spec.title };
      if (panelId !== undefined)
        return { ...facts, ...panelRead(services, run, { panelId, period }) };
      const panels = shownPanels(run).map(({ id, title, view }) => ({
        id,
        title,
        view: view.kind,
      }));
      return { ...facts, summaryPanels: run.spec.summaryPanels, panels };
    },
  });
}

/**
 * The tools that read reports.
 *
 * @param services - The MCP services.
 * @returns The tools.
 */
export function reportTools(services: McpServices): McpTool[] {
  return [listTool(services), runTool(services)];
}
