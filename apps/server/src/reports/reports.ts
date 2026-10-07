/**
 * The reports service: read reports and their runs, save and activate versions, run one now,
 * preview a spec, send a test, and what the scheduler needs: the runs due, the runs to try again,
 * one attempt, and the purge of old runs. No model takes part in any of it. People are named by
 * user id; the routes name them.
 */
import {
  latestRunAt,
  nextRunAt,
  periodLabel,
  type ReportDetail,
  type ReportListItem,
  type ReportPreview,
  type ReportRunDetail,
  type ReportRunSummary,
  type ReportSpec,
  type ReportSummary,
  reportSpecSchema,
  type SendResult,
} from '@quanthea/shared';
import { maxSnapshotBytes } from '../dashboards/snapshots.ts';
import { AppError } from '../lib/errors.ts';
import type { ReaderRole } from '../lib/reader-role.ts';
import {
  activate,
  checkReport,
  deactivate,
  type NewReportVersionInput,
  saveVersion,
} from './changes.ts';
import { type ReportsContext, type ReportsDependencies, reportOrThrow } from './context.ts';
import { listForReader } from './listing.ts';
import { reportMessage } from './messages.ts';
import { listRuns, type RunPage, readRun } from './reading.ts';
import { attemptRun, createRun } from './runs.ts';
import { readReport, summaryOf, toRunSummary } from './views.ts';

/** A run the scheduler starts, and what it counts against. */
export interface ScheduledRun {
  /** The run. */
  readonly runId: string;
  /** The connector of the report's first query, for the cap per connector. */
  readonly connector: string;
}

/** The reports service. */
export interface Reports {
  /**
   * Lists the reports the role may see, with their latest run, whether the reader has a finished
   * run to open, and the history of the first headline number.
   *
   * @param reader - The role of the reader, or how to find it from each report's thread.
   * @param readerId - The reader, by user id.
   * @returns The reports, the newest first.
   */
  list(reader: ReaderRole, readerId: string): ReportListItem[];
  /**
   * Reads a report with its versions.
   *
   * @param id - The report.
   * @param reader - The role of the reader, or how to find it from the report's thread: below
   *   editor, the versions ever active.
   * @returns The report.
   * @throws {AppError} `not_found`, also for a report never activated below editor.
   */
  get(id: string, reader: ReaderRole): Omit<ReportDetail, 'canChange'>;
  /**
   * The thread that made a report.
   *
   * @param id - The report.
   * @returns The thread, or `null` when it has none.
   * @throws {AppError} `not_found`.
   */
  threadOf(id: string): string | null;
  /**
   * Lists a report's runs, the latest period first.
   *
   * @param id - The report.
   * @param reader - The role of the reader, or how to find it from the report's thread.
   * @param page - Where the page starts, and its size.
   * @returns The runs.
   */
  runs(id: string, reader: ReaderRole, page: RunPage): ReportRunSummary[];
  /**
   * Reads one run with its frozen results and the runs either side.
   *
   * @param id - The report.
   * @param runId - The run.
   * @param reader - The role of the reader, or how to find it from the report's thread.
   * @returns The run.
   */
  run(id: string, runId: string, reader: ReaderRole): ReportRunDetail;
  /**
   * Records that a person opened a run, so the list stops showing it as new to them.
   *
   * @param id - The report.
   * @param runId - The run.
   * @param readerId - Who opened it, by user id.
   */
  see(id: string, runId: string, readerId: string): void;
  /**
   * Saves a new version from a spec, creating the report when none is named. The conversation
   * that writes reports calls it.
   *
   * @param input - The report, the spec, a note and the thread.
   * @param actor - Who saves.
   * @returns The report and the version number.
   */
  saveVersion(input: NewReportVersionInput, actor: string): { reportId: string; version: number };
  /**
   * Activates a version, once its queries ran over its latest period.
   *
   * @param id - The report.
   * @param version - The version.
   * @param actor - Who activates.
   * @returns The report.
   */
  activate(id: string, version: number, actor: string): Promise<ReportSummary>;
  /**
   * Stops a report's schedule.
   *
   * @param id - The report.
   * @param actor - Who deactivates.
   * @returns The report.
   */
  deactivate(id: string, actor: string): ReportSummary;
  /**
   * Runs the active version, else the latest, over its latest period, and waits for the first
   * attempt.
   *
   * @param id - The report.
   * @param send - Whether the outcome goes to the channels.
   * @param actor - Who runs it.
   * @returns The run.
   */
  runNow(id: string, send: boolean, actor: string): Promise<ReportRunSummary>;
  /**
   * Runs a spec over its latest period. Nothing is stored or sent.
   *
   * @param spec - The spec, as JSON.
   * @returns The results.
   */
  preview(spec: unknown): Promise<ReportPreview>;
  /**
   * Runs a version over its latest period and sends its message to its channels as a test.
   *
   * @param id - The report.
   * @param version - The version.
   * @param actor - Who sends it.
   * @returns Each channel's result.
   */
  sendTest(id: string, version: number, actor: string): Promise<SendResult[]>;
  /**
   * Makes the runs the schedule owes: one per report whose next run is due, for the latest
   * scheduled time, never a backlog. Each report's next run moves on.
   *
   * @returns The runs made, to attempt.
   */
  startDue(): ScheduledRun[];
  /**
   * Lists the running runs to attempt: those whose retry is due, and those no attempt is making,
   * such as one a restart cut short.
   *
   * @returns The runs.
   */
  pending(): ScheduledRun[];
  /**
   * Makes one attempt of a running run.
   *
   * @param runId - The run.
   * @returns Once the attempt is recorded and its message sent.
   */
  attempt(runId: string): Promise<void>;
  /**
   * Deletes the runs older than the retention setting keeps. Reports and versions stay.
   *
   * @returns How many runs it deleted.
   */
  purgeRuns(): number;
}

/** A day, in milliseconds. */
const dayMs = 86_400_000;

/**
 * The connector a report's runs count against: its first query's.
 *
 * @param spec - The spec.
 * @returns The connector's name.
 */
function connectorOf(spec: ReportSpec): string {
  return spec.panels[0]?.queries[0]?.connector ?? '';
}

/**
 * The version a report runs by hand: the active one, else the latest.
 *
 * @param context - The service context.
 * @param id - The report.
 * @returns The version and its spec.
 */
function versionToRun(context: ReportsContext, id: string) {
  const report = reportOrThrow(context, id);
  const version = report.activeVersion ?? report.latestVersion;
  const row = context.repository.version(id, version);
  if (!row) throw new AppError('not_found', `No report ${id}.`);
  return { version, spec: reportSpecSchema.parse(row.spec) };
}

/**
 * Makes the run a due report owes, and moves its next run on.
 *
 * @param context - The service context.
 * @param due - The report and its active spec, as stored.
 * @param now - The current instant.
 * @returns The run made, or none when the spec no longer parses or the run exists.
 */
function startOne(
  context: ReportsContext,
  due: ReturnType<ReportsContext['repository']['due']>[number],
  now: number,
): ScheduledRun[] {
  const parsed = reportSpecSchema.safeParse(due.spec);
  if (!parsed.success || due.report.activeVersion === null) return [];
  const spec = parsed.data;
  context.repository.setNextRun(due.report.id, nextRunAt(spec.schedule, now));
  const at = latestRunAt(spec.schedule, now);
  const request = { reportId: due.report.id, version: due.report.activeVersion, spec, at };
  const runId = createRun(context, { ...request, kind: 'schedule', notify: true, startedBy: null });
  return runId === null ? [] : [{ runId, connector: connectorOf(spec) }];
}

/**
 * The methods the scheduler calls.
 *
 * @param context - The service context.
 * @returns The methods.
 */
function scheduleMethods(
  context: ReportsContext,
): Pick<Reports, 'startDue' | 'pending' | 'attempt' | 'purgeRuns'> {
  return {
    startDue: () => {
      const now = context.now();
      return context.repository.due(now).flatMap((due) => startOne(context, due, now));
    },
    pending: () =>
      context.runs
        .pending(context.now())
        .filter((run) => !context.busy.has(run.id))
        .map((run) => {
          const spec = reportSpecSchema.safeParse(
            context.repository.version(run.reportId, run.version)?.spec,
          );
          return { runId: run.id, connector: spec.success ? connectorOf(spec.data) : '' };
        }),
    attempt: (runId) => attemptRun(context, runId),
    purgeRuns: () => {
      const { keepRunsDays } = context.settings.get();
      if (keepRunsDays === null) return 0;
      return context.runs.purgeBefore(context.now() - keepRunsDays * dayMs);
    },
  };
}

/**
 * Previews a spec over its latest period.
 *
 * @param context - The service context.
 * @param input - The spec, as JSON.
 * @returns The results, and the run that would follow.
 */
async function preview(context: ReportsContext, input: unknown): Promise<ReportPreview> {
  const { spec, periods, execution } = await checkReport(context, input);
  const zone = spec.schedule.timezone;
  const named = (range: { from: number; to: number }) => ({
    ...range,
    label: periodLabel(spec.period, range, zone),
  });
  return {
    period: named(periods.period),
    comparison: periods.comparison === null ? null : named(periods.comparison),
    ...execution,
    nextRunAt: nextRunAt(spec.schedule, context.now()),
  };
}

/**
 * Runs a version over its latest period and sends its message as a test.
 *
 * @param context - The service context.
 * @param id - The report.
 * @param version - The version.
 * @param actor - Who sends it.
 * @returns Each channel's result.
 */
async function sendTest(
  context: ReportsContext,
  id: string,
  version: number,
  actor: string,
): Promise<SendResult[]> {
  reportOrThrow(context, id);
  const row = context.repository.version(id, version);
  if (!row) throw new AppError('not_found', `Report ${id} has no version ${version}.`);
  const { spec, periods, execution } = await checkReport(context, row.spec);
  if (spec.delivery.channels.length === 0)
    throw new AppError('bad_request', 'This version sends to no channel. Add one first.');
  const subject = { reportId: id, version, spec, runId: null, ...periods, test: true };
  const event = execution.failure === null ? 'report.ready' : 'report.failed';
  const headlines = execution.headlines;
  const message = reportMessage(context, { ...subject, headlines }, event, execution.failure);
  context.audit.append({ actor, action: 'report.test', target: id, detail: { version } });
  return context.sendReport(spec.delivery.channels, message);
}

/**
 * Runs a report now.
 *
 * @param context - The service context.
 * @param id - The report.
 * @param send - Whether the outcome goes to the channels.
 * @param actor - Who runs it.
 * @returns The run, after its first attempt.
 */
async function runNow(
  context: ReportsContext,
  id: string,
  send: boolean,
  actor: string,
): Promise<ReportRunSummary> {
  const { version, spec } = versionToRun(context, id);
  const request = { reportId: id, version, spec, kind: 'manual' as const, at: context.now() };
  const runId = createRun(context, { ...request, notify: send, startedBy: actor });
  if (runId === null) throw new AppError('conflict', 'The run could not be made.');
  context.audit.append({ actor, action: 'report.run', target: id, detail: { runId, send } });
  await attemptRun(context, runId);
  const run = context.runs.get(runId);
  if (!run) throw new AppError('not_found', `Report ${id} has no run ${runId}.`);
  return toRunSummary(run, spec);
}

/**
 * Creates the reports service.
 *
 * @param dependencies - The stores, the connectors, the channels, the settings and the clock.
 * @returns The service.
 */
export function createReports(dependencies: ReportsDependencies): Reports {
  const context: ReportsContext = {
    ...dependencies,
    now: dependencies.now ?? Date.now,
    maxBytes: dependencies.maxBytes ?? maxSnapshotBytes,
    origin: dependencies.publicUrl?.replace(/\/$/, '') ?? '',
    busy: new Set(),
  };
  return {
    list: (reader, readerId) => listForReader(context, reader, readerId),
    get: (id, reader) => readReport(context, id, reader),
    threadOf: (id) => reportOrThrow(context, id).threadId,
    runs: (id, reader, page) => listRuns(context, id, reader, page),
    run: (id, runId, reader) => readRun(context, id, runId, reader),
    see: (id, runId, readerId) => context.seen?.see(readerId, id, runId, context.now()),
    saveVersion: (input, actor) => saveVersion(context, input, actor),
    activate: async (id, version, actor) => {
      await activate(context, id, version, actor);
      return summaryOf(context, id, 'editor');
    },
    deactivate: (id, actor) => {
      deactivate(context, id, actor);
      return summaryOf(context, id, 'editor');
    },
    runNow: (id, send, actor) => runNow(context, id, send, actor),
    preview: (spec) => preview(context, spec),
    sendTest: (id, version, actor) => sendTest(context, id, version, actor),
    ...scheduleMethods(context),
  };
}
