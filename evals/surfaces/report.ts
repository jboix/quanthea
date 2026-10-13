/**
 * The report surface: a thread that writes a report. A case's turns are talked through, then the
 * report's latest version is read, previewed and run now through the reports service, at the
 * evals' clock, so its numbers can be checked.
 */
import type { ReportSpec } from '@quanthea/shared';
import type { ReportCaseOutcome, RunSummary } from '../checks/report.ts';
import type { Given, ThreadInput } from '../core/case.ts';
import type { Acted } from '../core/result.ts';
import { type EvalWorld, evalsActor } from '../world/setup.ts';
import { conductOf } from './alert.ts';
import { messagesOf, talk, toolTrace } from './thread.ts';

/** The report a thread wrote: its id, latest version and how many versions it has. */
interface Written {
  /** The report. */
  readonly reportId: string;
  /** The latest version's spec. */
  readonly spec: ReportSpec;
  /** How many versions it has. */
  readonly count: number;
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
 * Runs the report now, at the evals' clock, over its latest period.
 *
 * @param world - The world.
 * @param reportId - The report.
 * @returns The run, as the evidence keeps it.
 */
async function runOf(world: EvalWorld, reportId: string): Promise<RunSummary> {
  const made = await world.services.reports.runNow(reportId, false, evalsActor);
  const { status, error, period, headlines } = made;
  return { status, error, period, headlines };
}

/**
 * What the report holds: its spec, the versions the case saved, its preview and a run of it.
 *
 * @param world - The world.
 * @param threadId - The thread.
 * @param before - How many versions the report had before the case.
 * @returns The fields of the evidence they fill.
 */
async function reportOf(
  world: EvalWorld,
  threadId: string,
  before: number,
): Promise<Partial<ReportCaseOutcome> & { versions: number }> {
  const written = writtenOf(world, threadId);
  if (!written) return { versions: 0 };
  const { reportId, spec } = written;
  try {
    const previewFailure = await previewFailureOf(world, spec);
    const run = await runOf(world, reportId);
    return { spec, versions: written.count - before, previewFailure, run };
  } catch (failure) {
    const reason = failure instanceof Error ? failure.message : String(failure);
    return { versions: 0, error: `reading the report failed: ${reason}` };
  }
}

/**
 * Talks a case's turns through in a report thread and reads what came of it.
 *
 * @param world - The world.
 * @param given - What the fixture left: a report thread to continue, or nothing.
 * @param input - The turns.
 * @param id - The case's id.
 * @returns The evidence and the tool calls.
 */
export async function actReport(
  world: EvalWorld,
  given: Given,
  input: ThreadInput,
  id: string,
): Promise<Acted<ReportCaseOutcome>> {
  const { threads } = world.services;
  const threadId =
    given.threadId ?? threads.create(evalsActor, null, undefined, { kind: 'report' as const }).id;
  const before = writtenOf(world, threadId)?.count ?? 0;
  const seen = messagesOf(world, threadId).length;
  const started = Date.now();
  let turns = 0;
  let error: string | undefined;
  try {
    turns = await talk(world, threadId, input);
  } catch (failure) {
    error = failure instanceof Error ? failure.message : String(failure);
  }
  const durationMs = Date.now() - started;
  const messages = messagesOf(world, threadId).slice(seen);
  const evidence: ReportCaseOutcome = {
    kind: 'report',
    id,
    channelIds: [world.channelId],
    ...(await reportOf(world, threadId, before)),
    ...conductOf(messages, 'edit_report'),
    turns,
    durationMs,
    ...(error === undefined ? {} : { error }),
  };
  return { evidence, toolCalls: toolTrace(messages) };
}
