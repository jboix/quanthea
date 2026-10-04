/**
 * Runs the report cases as a person would in a report thread: sets the dev connectors' access
 * level, asks, answers the agent's question, approves the plan, and lets the agent write. Then it
 * reads the report's latest version, previews it, and, for a case that checks its numbers, runs it
 * now through the reports service, at the evals' clock, and counts the period's orders on the dev
 * Postgres directly.
 */
import type { ReportSpec } from '@quanthea/shared';
import { conductOf } from './alert-drive.ts';
import { type AnswerBench, setLevel } from './answer-drive.ts';
import { converse, messagesOf } from './drive.ts';
import { type ReportCase, reportCases } from './report-cases.ts';
import type { ReportCaseOutcome, RunSummary } from './report-score.ts';
import { orderTruth } from './report-truth.ts';
import { type EvalWorld, evalsActor } from './setup.ts';

/** A run a report case made, by its report. */
export interface MadeRun {
  /** The report. */
  readonly reportId: string;
  /** The run. */
  readonly runId: string;
}

/** The dev connectors, and the threads and runs of the report cases so far. */
export interface ReportBench {
  /** The pinned checkout incident dashboard, which report threads may link, and the connectors. */
  readonly bench: AnswerBench;
  /** The thread of each report case run so far, for follow-ups. */
  readonly threads: Map<string, string>;
  /** The run each report case made, for the questions about it. */
  readonly runs: Map<string, MadeRun>;
}

/** The report a thread wrote: its id, latest version and how many versions it has. */
interface Written {
  /** The report. */
  readonly reportId: string;
  /** The latest version's spec. */
  readonly spec: ReportSpec;
  /** How many versions it has. */
  readonly count: number;
}

/** What talking a case through gave. */
interface Talk {
  /** The thread; empty when none was started. */
  readonly threadId: string;
  /** How many runs it took. */
  readonly turns: number;
  /** How many versions the report had before, and how many messages the thread had. */
  readonly mark: { readonly before: number; readonly seen: number };
  /** How long it took, in milliseconds. */
  readonly durationMs: number;
  /** Why a run failed, when one did. */
  readonly error?: string;
}

/**
 * The report a thread wrote, if it wrote one.
 *
 * @param world - The world.
 * @param threadId - The thread.
 * @returns The report and its latest version.
 */
function writtenOf(world: EvalWorld, threadId: string): Written | undefined {
  const { reportId } = world.services.threads.get(threadId);
  if (reportId === null) return undefined;
  const { versions } = world.services.reports.get(reportId, 'editor');
  const latest = versions.reduce((best, each) => (each.version > best.version ? each : best));
  return { reportId, spec: latest.spec, count: versions.length };
}

/**
 * Talks a case through in its thread: the one of the case it follows, or a new report thread.
 *
 * @param world - The world.
 * @param reportBench - The bench.
 * @param reportCase - The case.
 * @returns The thread and how many runs the case took.
 */
async function talk(
  world: EvalWorld,
  reportBench: ReportBench,
  reportCase: ReportCase,
): Promise<{ threadId: string; turns: number }> {
  const followed = reportCase.follows && reportBench.threads.get(reportCase.follows);
  const threadId =
    followed ||
    world.services.threads.create(evalsActor, null, undefined, { kind: 'report' as const }).id;
  reportBench.threads.set(reportCase.id, threadId);
  await setLevel(world, reportBench.bench, reportCase.accessLevel);
  return { threadId, turns: await converse(world, threadId, reportCase) };
}

/**
 * Where the thread a case continues stands: nothing for a new thread.
 *
 * @param world - The world.
 * @param reportBench - The bench.
 * @param reportCase - The case.
 * @returns How many versions and messages it had.
 */
function markOf(world: EvalWorld, reportBench: ReportBench, reportCase: ReportCase) {
  const previous = reportBench.threads.get(reportCase.follows ?? '');
  if (!previous) return { before: 0, seen: 0 };
  const before = writtenOf(world, previous)?.count ?? 0;
  return { before, seen: messagesOf(world, previous).length };
}

/**
 * Talks a case through, after the case it follows when the run has not talked it yet (that one
 * is not reported), and says where its thread stood before.
 *
 * @param world - The world.
 * @param reportBench - The bench.
 * @param reportCase - The case.
 * @returns The talk, with the error a run gave, if any.
 */
async function attempt(
  world: EvalWorld,
  reportBench: ReportBench,
  reportCase: ReportCase,
): Promise<Talk> {
  let mark = { before: 0, seen: 0 };
  let started = Date.now();
  try {
    const parent = reportCases.find((each) => each.id === reportCase.follows);
    if (parent?.mode === 'write' && !reportBench.threads.has(parent.id))
      await talk(world, reportBench, parent);
    mark = markOf(world, reportBench, reportCase);
    started = Date.now();
    const run = await talk(world, reportBench, reportCase);
    return { ...run, mark, durationMs: Date.now() - started };
  } catch (failure) {
    const threadId = reportBench.threads.get(reportCase.id) ?? '';
    const error = failure instanceof Error ? failure.message : String(failure);
    return { threadId, turns: 0, mark, durationMs: Date.now() - started, error };
  }
}

/**
 * Previews a spec over its latest period, as the draft pane does.
 *
 * @param world - The world.
 * @param spec - The spec.
 * @returns Why it failed, or `null` when every query ran.
 */
async function previewFailureOf(world: EvalWorld, spec: ReportSpec): Promise<string | null> {
  try {
    return (await world.services.reports.preview(spec)).failure;
  } catch (failure) {
    return failure instanceof Error ? failure.message : String(failure);
  }
}

/**
 * Runs the report now, at the evals' clock, over its latest period, and counts that period's
 * orders on the dev Postgres. The run is kept for the questions about it.
 *
 * @param world - The world.
 * @param reportBench - The bench.
 * @param reportCase - The case.
 * @param reportId - The report.
 * @returns The fields of the outcome they fill.
 */
async function runOf(
  world: EvalWorld,
  reportBench: ReportBench,
  reportCase: ReportCase,
  reportId: string,
): Promise<Pick<ReportCaseOutcome, 'run' | 'truth'>> {
  const made = await world.services.reports.runNow(reportId, false, evalsActor);
  reportBench.runs.set(reportCase.id, { reportId, runId: made.id });
  const { status, error, period, headlines } = made;
  const run: RunSummary = { status, error, period, headlines };
  if (status !== 'ok') return { run };
  return { run, truth: await orderTruth(period) };
}

/**
 * What the report holds: its spec, the versions the case saved, its preview and its run.
 *
 * @param world - The world.
 * @param reportBench - The bench.
 * @param reportCase - The case.
 * @param talked - The talk, for the thread and the versions before.
 * @returns The fields of the outcome they fill.
 */
async function reportOf(
  world: EvalWorld,
  reportBench: ReportBench,
  reportCase: ReportCase,
  talked: Talk,
): Promise<Partial<ReportCaseOutcome> & { versions: number }> {
  const written = talked.threadId ? writtenOf(world, talked.threadId) : undefined;
  if (!written) return { versions: 0 };
  const { reportId, spec } = written;
  const previewFailure = await previewFailureOf(world, spec);
  const versions = written.count - talked.mark.before;
  const checked = reportCase.expect.checkRun
    ? await runOf(world, reportBench, reportCase, reportId)
    : {};
  return { spec, versions, previewFailure, ...checked };
}

/**
 * Runs one report case and reads what came of it.
 *
 * @param world - The world.
 * @param reportBench - The bench.
 * @param reportCase - The case.
 * @returns The outcome.
 */
export async function driveReport(
  world: EvalWorld,
  reportBench: ReportBench,
  reportCase: ReportCase,
): Promise<ReportCaseOutcome> {
  const talked = await attempt(world, reportBench, reportCase);
  const { threadId, turns, durationMs, error } = talked;
  const messages = threadId ? messagesOf(world, threadId).slice(talked.mark.seen) : [];
  let made: Awaited<ReturnType<typeof reportOf>>;
  try {
    made = await reportOf(world, reportBench, reportCase, talked);
  } catch (failure) {
    const reason = failure instanceof Error ? failure.message : String(failure);
    made = { versions: 0, error: `reading the report failed: ${reason}` };
  }
  return {
    kind: 'report',
    id: reportCase.id,
    channelIds: [world.channelId],
    ...made,
    ...conductOf(messages, 'edit_report'),
    turns,
    durationMs,
    ...(error === undefined ? {} : { error }),
  };
}
