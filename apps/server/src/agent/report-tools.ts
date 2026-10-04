/**
 * The tools of a report thread: propose the report, and write it. Its panels are built, test-run
 * and completed by the same path as a dashboard's; the reports service then checks the whole spec
 * and previews it once over its latest period, and the version is saved as a draft. What the model
 * learns of the data passes through the gate.
 */
import type { DashboardSpec, ReportPlan } from '@quanthea/shared';
import { tool } from 'ai';
import { z } from 'zod';
import { AppError } from '../lib/errors.ts';
import { type BuiltPanels, buildPanels } from './panel-build.ts';
import {
  currentReport,
  mergeReport,
  type ReportEdit,
  type ReportTiming,
  reportEditSchemaFor,
  startingDashboard,
  timingOf,
} from './report-edit.ts';
import type { RunContext } from './run-context.ts';
import { providerSchema } from './tool-schema.ts';
import {
  failingPanels,
  nextAttempt,
  type PanelReport,
  reportsOf,
  writeRepair,
} from './write-version.ts';

/** An issue with a spec: where, and what is wrong. */
type Issue = { readonly path: string; readonly message: string };

/** A pinned dashboard a report may link to. */
interface PinnedChoice {
  /** Its id. */
  readonly id: string;
  /** Its title. */
  readonly title: string;
}

/**
 * The pinned dashboards a report may link to.
 *
 * @param context - The run.
 * @returns Their ids and titles.
 */
export function pinnedChoices(context: RunContext): PinnedChoice[] {
  const { results } = context.dashboards.searchLibrary({ tags: [], connectors: [] });
  return results.map((entry) => ({ id: entry.dashboardId, title: entry.title }));
}

/**
 * The ids an edit or a plan names that no channel or pinned dashboard has.
 *
 * @param context - The run.
 * @param channels - The channel ids, if set.
 * @param dashboards - The dashboard ids, if set.
 * @returns The issues, at each unknown id's path.
 */
function unknownTargets(
  context: RunContext,
  channels: readonly string[] | undefined,
  dashboards: readonly string[] | undefined,
): Issue[] {
  const knownChannels = new Set((context.channels?.() ?? []).map((channel) => channel.id));
  const knownDashboards = new Set(pinnedChoices(context).map((dashboard) => dashboard.id));
  const channelIssues = (channels ?? []).flatMap((id, index) =>
    knownChannels.has(id)
      ? []
      : [{ path: `channels[${index}]`, message: `No channel "${id}". Use an id from the list.` }],
  );
  const dashboardIssues = (dashboards ?? []).flatMap((id, index) =>
    knownDashboards.has(id)
      ? []
      : [
          {
            path: `seeAlso[${index}].dashboardId`,
            message: `No pinned dashboard "${id}". Use an id from the list.`,
          },
        ],
  );
  return [...channelIssues, ...dashboardIssues];
}

/** Validates what `propose_report` takes: the plan in words, links and channels by id. */
const proposeReportSchema = z.strictObject({
  title: z.string().min(1).max(200),
  runs: z.string().min(1).max(200),
  covers: z.string().min(1).max(200),
  compares: z.string().min(1).max(200),
  shows: z.string().min(1).max(300),
  connectors: z.array(z.string().min(1).max(63)).max(10),
  seeAlso: z.array(z.string().min(1).max(64)).max(5),
  channels: z.array(z.string().min(1).max(64)).max(20),
});

/**
 * The plan's body: its words, with each link and channel named.
 *
 * @param context - The run.
 * @param input - The plan as proposed.
 * @returns The body.
 */
function planBody(context: RunContext, input: z.infer<typeof proposeReportSchema>): ReportPlan {
  const channels = context.channels?.() ?? [];
  const pinned = pinnedChoices(context);
  const nameOf = (id: string, list: readonly { id: string; name?: string; title?: string }[]) => {
    const found = list.find((each) => each.id === id);
    return found?.name ?? found?.title ?? id;
  };
  return {
    kind: 'report',
    ...input,
    seeAlso: input.seeAlso.map((id) => ({ id, name: nameOf(id, pinned) })),
    channels: input.channels.map((id) => ({ id, name: nameOf(id, channels) })),
  };
}

/**
 * The tool that proposes a report plan.
 *
 * @param context - The run.
 * @returns The tool.
 */
function proposeReportTool(context: RunContext) {
  return tool({
    description:
      'Propose the report before writing it: its title; when it runs, the period each run covers and what it compares with, in words; what it shows; the connectors it reads; the pinned dashboards it links to and the channels it is sent to, by id. The person approves it; then you write it. Call it once, as your last action.',
    inputSchema: providerSchema(proposeReportSchema),
    execute: (input) => {
      const issues = unknownTargets(context, input.channels, input.seeAlso);
      if (issues.length > 0) return { error: issues.map((issue) => issue.message).join(' ') };
      const body = planBody(context, input);
      const autoApprove = !context.settings.behaviour.planApproval;
      const proposed = context.threads.proposePlan(context.threadId, body, autoApprove);
      const data = { planId: proposed.id, body };
      context.writer.write({ type: 'data-reportPlan', id: proposed.id, data });
      context.counters.planPending = !autoApprove;
      const next = autoApprove
        ? 'Approved. Write it now with edit_report.'
        : 'Waiting for the person to approve. Stop here.';
      return { planId: proposed.id, status: proposed.status, next };
    },
  });
}

/**
 * Why the thread may not write the report now, if it may not.
 *
 * @param context - The run.
 * @returns The reason, or `undefined` when the write may go ahead.
 */
function reportRefusal(context: RunContext): string | undefined {
  if (!context.reports) return 'Reports are off.';
  const { state } = context.threads.row(context.threadId);
  if (state === 'building' || state === 'ready') return undefined;
  if (state === 'plan_pending') return 'A plan waits for approval. Stop and let the person decide.';
  return 'Propose the report with propose_report first.';
}

/** A failed write, as the build log and the model see it. */
interface Failure {
  /** What failed. */
  readonly error: string;
  /** The spec's issues, by path. */
  readonly issues?: readonly Issue[];
  /** The dashboard the edit made, for the panels' titles. */
  readonly spec?: Pick<DashboardSpec, 'panels'>;
  /** Each panel's test run, through the gate. */
  readonly panels?: readonly PanelReport[];
  /** The panels that do not work. */
  readonly failing?: readonly string[];
}

/**
 * Counts a failed write, streams it for the build log, and says what the model does next.
 *
 * @param context - The run.
 * @param failure - What failed.
 * @returns The failure the model sees.
 */
function failReport(context: RunContext, failure: Failure) {
  const next = nextAttempt(context, 'Fix it and write again');
  const { spec = { panels: [] }, issues = [], panels = [], failing = [] } = failure;
  writeRepair(context, { kind: 'failed', spec, panels, failing, issues });
  return { ok: false as const, error: `${failure.error} ${next}`, issues, panels };
}

/** A report version to save: the merged spec, what changed, and the thread's report. */
interface ReportWrite {
  /** The merged spec, as JSON. */
  readonly spec: Record<string, unknown>;
  /** What changed, in one line. */
  readonly note: string;
  /** The thread's report, once it has one. */
  readonly reportId: string | undefined;
}

/**
 * Saves a previewed spec as the thread's next report version, and streams it.
 *
 * @param context - The run.
 * @param write - The spec, the note and the report.
 * @returns The version.
 */
function saveReport(context: RunContext, write: ReportWrite): number {
  const reports = context.reports as NonNullable<RunContext['reports']>;
  const { spec, note, reportId } = write;
  const input = { spec, note, threadId: context.threadId, ...(reportId ? { reportId } : {}) };
  const saved = reports.saveVersion(input, context.actor);
  context.threads.apply(context.threadId, 'built');
  context.threads.name(context.threadId, String(spec.title));
  context.writer.write({ type: 'data-reportVersion', data: { ...saved, note } });
  if (context.counters.failedWrites > 0)
    writeRepair(context, { kind: 'repaired', spec: { panels: [] } });
  return saved.version;
}

/**
 * The issues an application error carries, if any.
 *
 * @param error - The error.
 * @returns The issues.
 */
function issuesOf(error: AppError): Issue[] {
  if (!Array.isArray(error.details)) return [];
  return (error.details as Issue[]).map(({ path, message }) => ({ path, message }));
}

/**
 * Previews the merged spec once over its latest period, then saves it.
 *
 * @param context - The run.
 * @param write - The spec, the note and the report.
 * @returns The version, the periods and the next run, or the failure.
 */
async function previewAndSave(context: RunContext, write: ReportWrite) {
  const reports = context.reports as NonNullable<RunContext['reports']>;
  try {
    const preview = await reports.preview(write.spec);
    if (preview.failure !== null)
      return failReport(context, { error: `The report does not run: ${preview.failure}` });
    const version = saveReport(context, write);
    const periods = { period: preview.period.label, comparison: preview.comparison?.label ?? null };
    const nextRunAt = new Date(preview.nextRunAt).toISOString();
    return { ok: true as const, version, ...periods, nextRunAt };
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== 'bad_request') throw error;
    return failReport(context, { error: error.message, issues: issuesOf(error) });
  }
}

/**
 * Checks the built panels: each must work, and so must the markers the edit sets.
 *
 * @param context - The run.
 * @param built - The built panels.
 * @returns The panel reports, or the failure.
 */
function checkPanels(context: RunContext, built: BuiltPanels) {
  const panels = reportsOf(context, built.spec, built.run);
  const markerIssues = built.run.markerIssues ?? [];
  if (markerIssues.length > 0)
    return failReport(context, { error: 'The markers do not work.', issues: markerIssues, panels });
  const failing = failingPanels(panels, true);
  if (failing.length > 0) {
    const failure = { error: 'Some panels do not work.', spec: built.spec, panels, failing };
    return failReport(context, failure);
  }
  return { ok: true as const, panels };
}

/**
 * Builds the edit's panels over the latest period, on the draft's or a new dashboard.
 *
 * @param context - The run.
 * @param edit - The edit.
 * @param timing - The schedule and the latest period.
 * @returns The built panels, or the failure.
 */
async function builtFor(context: RunContext, edit: ReportEdit, timing: ReportTiming) {
  const start = startingDashboard(currentReport(context)?.spec, edit, timing);
  if (!start) return failReport(context, { error: 'Give the new report a title.' });
  const built = await buildPanels(context, start, edit, 'The report is invalid.');
  if ('error' in built)
    return failReport(context, { error: built.error, issues: built.issues ?? [] });
  return built;
}

/**
 * Writes the report: builds and test-runs its panels over the latest period, merges the report's
 * fields over the draft, previews it once, saves a new draft version, and tells the model what the
 * gate lets through of the panels.
 *
 * @param context - The run.
 * @param edit - The edit.
 * @param now - The current instant.
 * @returns What the model learns.
 */
async function editReport(context: RunContext, edit: ReportEdit, now: number) {
  const refused = reportRefusal(context);
  if (refused !== undefined) return { ok: false, error: refused };
  const targets = unknownTargets(
    context,
    edit.channels,
    edit.seeAlso?.map((link) => link.dashboardId),
  );
  if (targets.length > 0) return failReport(context, { error: 'Unknown ids.', issues: targets });
  const current = currentReport(context);
  const timing = timingOf(current?.spec, edit, now);
  if (Array.isArray(timing)) return failReport(context, { error: 'No schedule.', issues: timing });
  const built = await builtFor(context, edit, timing);
  if ('ok' in built) return built;
  const checked = checkPanels(context, built);
  if (!checked.ok) return checked;
  const spec = mergeReport(current?.spec, built.spec, edit, timing);
  const write = { spec, note: edit.summary, reportId: current?.reportId };
  const saved = await previewAndSave(context, write);
  return saved.ok ? { ...saved, panels: checked.panels } : saved;
}

/**
 * The tool that writes the report.
 *
 * @param context - The run.
 * @param now - The clock, for the latest period.
 * @returns The tool.
 */
function editReportTool(context: RunContext, now: () => number) {
  return tool({
    description:
      'Write the report as a new draft version: its title; panels, each data (a query builder, a saved query or a raw query) and a chart recipe, as edit_dashboard takes them, filtering on the period with :__from and :__to; the schedule, the period, the comparison, the headline stat panels (by id or title), the pinned dashboards to link and the channels, by id. The first write sets the title, the schedule and the period; later ones send only what changes. The server test-runs every panel over the latest period, checks the report and previews it once; you get each panel’s result, or the errors to fix.',
    inputSchema: providerSchema(reportEditSchemaFor(context.queries, context.charts)),
    execute: (edit) => editReport(context, edit, now()),
  });
}

/**
 * Creates the report tools of a run.
 *
 * @param context - The run.
 * @param now - The clock.
 * @returns The tools.
 */
export function reportTools(context: RunContext, now: () => number) {
  return {
    propose_report: proposeReportTool(context),
    edit_report: editReportTool(context, now),
  };
}
