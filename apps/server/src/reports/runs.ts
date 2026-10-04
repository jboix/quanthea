/**
 * Report runs: made for a period, then attempted. An attempt runs every panel over the period and
 * the comparison period with no model; it freezes the results, or tries again after the delay the
 * settings give, up to their number of retries, and then fails. A run that notifies sends
 * `report.ready` once it succeeds, and `report.failed` once it fails for good, when the global
 * "cannot be checked" setting is on.
 */
import {
  comparisonPeriod,
  dashboardOfReport,
  durationMs,
  type ReportSpec,
  reportSpecSchema,
  resolvePeriod,
} from '@quanthea/shared';
import { shownVariables } from '../dashboards/snapshots.ts';
import type { RunKind, RunRow } from '../db/report-run-repository.ts';
import { newId } from '../lib/ids.ts';
import type { ReportsContext } from './context.ts';
import { type Execution, executeReport } from './execute.ts';
import { type MessageSubject, reportMessage } from './messages.ts';

/** A run to make. */
export interface RunRequest {
  /** The report. */
  readonly reportId: string;
  /** The version to run. */
  readonly version: number;
  /** Its spec. */
  readonly spec: ReportSpec;
  /** What starts it. */
  readonly kind: RunKind;
  /** The instant the period is resolved at: the scheduled time, or now. */
  readonly at: number;
  /** Whether its outcome goes to the channels. */
  readonly notify: boolean;
  /** Who runs it by hand; `null` for the schedule. */
  readonly startedBy: string | null;
}

/** Turns text into bytes, to measure it. */
const encoder = new TextEncoder();

/**
 * The period a run covers and the period it compares with.
 *
 * @param spec - The report spec.
 * @param at - The instant the periods are resolved at.
 * @returns The two periods; no comparison when the spec compares with nothing.
 */
export function periodsAt(spec: ReportSpec, at: number) {
  const zone = spec.schedule.timezone;
  const period = resolvePeriod(spec.period, at, zone);
  const comparison = spec.compare === 'none' ? null : comparisonPeriod(spec.period, at, zone);
  return { period, comparison };
}

/**
 * Makes a run, running, with no attempt yet.
 *
 * @param context - The service context.
 * @param request - The report, version, spec, kind, instant and who.
 * @returns The run's id, or `null` when the schedule already made a run for that time.
 */
export function createRun(context: ReportsContext, request: RunRequest): string | null {
  const { reportId, version, spec, kind, at, notify, startedBy } = request;
  const id = newId();
  const periods = periodsAt(spec, at);
  const variables = shownVariables(dashboardOfReport(spec, periods.period), {});
  const run = {
    ...{ id, reportId, version, kind, scheduledAt: kind === 'schedule' ? at : null },
    ...periods,
    ...{ variables, notify, startedBy, createdAt: context.now() },
  };
  return context.runs.insert(run) ? id : null;
}

/**
 * Sends a run's outcome to its channels and records it, when the run notifies.
 *
 * @param context - The service context.
 * @param run - The run.
 * @param subject - What the message is about.
 * @param reason - Why it failed, or `null` when it is ready.
 */
async function announce(
  context: ReportsContext,
  run: RunRow,
  subject: MessageSubject,
  reason: string | null,
): Promise<void> {
  const channels = subject.spec.delivery.channels;
  if (!run.notify || channels.length === 0) return;
  if (reason !== null && !context.notifyOnError()) return;
  const event = reason === null ? 'report.ready' : 'report.failed';
  const message = reportMessage(context, subject, event, reason);
  const results = await context.sendReport(channels, message);
  context.runs.markSent(run.id, context.now(), results);
}

/**
 * Records a failed attempt: it tries again after the delay while retries remain, else it fails
 * for good and says so.
 *
 * @param context - The service context.
 * @param run - The run.
 * @param subject - What a message would be about.
 * @param reason - Why the attempt failed.
 */
async function failAttempt(
  context: ReportsContext,
  run: RunRow,
  subject: MessageSubject,
  reason: string,
): Promise<void> {
  const { maxRetries, retryDelay } = context.settings.get();
  const now = context.now();
  if (run.attempts <= maxRetries) {
    context.runs.retryLater(run.id, reason, now, now + durationMs(retryDelay));
    return;
  }
  context.runs.fail(run.id, reason, now);
  await announce(context, run, subject, reason);
}

/**
 * Stores a successful attempt's results, unless they pass the size cap.
 *
 * @param context - The service context.
 * @param run - The run.
 * @param results - The results.
 * @returns Why it could not be stored, or `null` once stored.
 */
function storeResults(context: ReportsContext, run: RunRow, results: Execution): string | null {
  const panels = JSON.stringify(results.panels);
  const comparison =
    results.comparisonPanels === null ? null : JSON.stringify(results.comparisonPanels);
  const bytes = encoder.encode(panels).byteLength + encoder.encode(comparison ?? '').byteLength;
  if (bytes > context.maxBytes) {
    const megabytes = (count: number) => (count / 1_048_576).toFixed(1);
    return `The results take ${megabytes(bytes)} MB; a run keeps at most ${megabytes(context.maxBytes)} MB.`;
  }
  const headlines = JSON.stringify(results.headlines);
  context.runs.succeed(run.id, { panels, comparison, headlines, bytes }, context.now());
  return null;
}

/**
 * Makes one attempt of a run that is running.
 *
 * @param context - The service context.
 * @param run - The run, its attempt counted.
 * @param spec - The spec of its version.
 */
async function attempt(context: ReportsContext, run: RunRow, spec: ReportSpec): Promise<void> {
  const runner = { openSource: context.openSource, executor: context.executor, now: context.now };
  const execution = await executeReport(runner, spec, run.period, run.comparison).catch(
    (error: unknown): Execution => {
      context.logger?.error('a report run failed', { runId: run.id, error: String(error) });
      const failure = 'The run could not be completed.';
      return { panels: {}, comparisonPanels: null, headlines: [], failure };
    },
  );
  const { reportId, version, period, comparison } = run;
  const subject = { reportId, version, spec, runId: run.id, period, comparison, test: false };
  const failure = execution.failure ?? storeResults(context, run, execution);
  if (failure !== null) return failAttempt(context, run, { ...subject, headlines: [] }, failure);
  await announce(context, run, { ...subject, headlines: execution.headlines }, null);
}

/**
 * Attempts a run that is running, once, unless an attempt is under way in this process.
 *
 * @param context - The service context.
 * @param runId - The run.
 */
export async function attemptRun(context: ReportsContext, runId: string): Promise<void> {
  if (context.busy.has(runId)) return;
  context.busy.add(runId);
  try {
    const stored = context.runs.get(runId);
    if (stored?.status !== 'running') return;
    const spec = reportSpecSchema.parse(
      context.repository.version(stored.reportId, stored.version)?.spec,
    );
    const attempts = context.runs.startAttempt(runId);
    await attempt(context, { ...stored, attempts }, spec);
  } finally {
    context.busy.delete(runId);
  }
}
