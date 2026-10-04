/**
 * Runs the alert cases as a person would in an alert thread: sets the dev connectors' access
 * level, asks, answers the agent's question, approves the plan, and lets the agent write. Then it
 * reads the alert's latest version, replays it over yesterday through the alerts service, and, for
 * a thread started from a panel, compares the fingerprints and reads the links.
 */
import { incidentStart } from '@quanthea/dev/metrics/incident.ts';
import fixture from '@quanthea/dev/seed/checkout-incident.json' with { type: 'json' };
import { queryFingerprint } from '@quanthea/server/src/alerts/fingerprint.ts';
import type { AlertReplay, AlertSpec, QueryTemplate } from '@quanthea/shared';
import { type AlertCase, alertCases } from './alert-cases.ts';
import type { AlertCaseOutcome, PanelMatch, ReplaySummary } from './alert-score.ts';
import { type AnswerBench, setLevel } from './answer-drive.ts';
import { converse, messagesOf, type StoredMessage, tally } from './drive.ts';
import { type EvalWorld, evalsActor, evalsNow } from './setup.ts';

/** How much of what the agent said the report keeps. */
const saidChars = 2000;

/** A day, in milliseconds: the replay covers the day before the run's clock. */
const dayMs = 86_400_000;

/** The pinned dashboard alert threads may start from, and the thread of each case so far. */
export interface AlertBench {
  /** The pinned checkout incident dashboard, and the dev connectors. */
  readonly bench: AnswerBench;
  /** The thread of each case run so far, for follow-ups. */
  readonly threads: Map<string, string>;
}

/** The alert a thread wrote: its id, latest version and how many versions it has. */
interface Written {
  /** The alert. */
  readonly alertId: string;
  /** The latest version's number. */
  readonly version: number;
  /** The latest version's spec. */
  readonly spec: AlertSpec;
  /** How many versions it has. */
  readonly count: number;
}

/**
 * The thread a case talks in: the one of the case it follows, or a new alert thread, started
 * from its panel when it names one.
 *
 * @param world - The world.
 * @param alertBench - The bench.
 * @param alertCase - The case.
 * @returns The thread's id.
 */
function threadOf(world: EvalWorld, alertBench: AlertBench, alertCase: AlertCase): string {
  const followed = alertCase.follows && alertBench.threads.get(alertCase.follows);
  if (followed) return followed;
  const { dashboardId } = alertBench.bench;
  const seed =
    alertCase.panelId === undefined
      ? undefined
      : { dashboardId, version: 1, panelId: alertCase.panelId };
  const start = { kind: 'alert' as const, seed };
  return world.services.threads.create(evalsActor, null, undefined, start).id;
}

/**
 * The alert a thread wrote, if it wrote one.
 *
 * @param world - The world.
 * @param threadId - The thread.
 * @returns The alert and its latest version.
 */
function writtenOf(world: EvalWorld, threadId: string): Written | undefined {
  const { alertId } = world.services.threads.get(threadId);
  if (alertId === null) return undefined;
  const { versions } = world.services.alerts.get(alertId, 'editor');
  const latest = versions.reduce((best, each) => (each.version > best.version ? each : best));
  return { alertId, version: latest.version, spec: latest.spec, count: versions.length };
}

/** Where a thread stood before a case: its alert's versions and its messages. */
interface Mark {
  /** How many versions its alert had. */
  readonly before: number;
  /** How many messages it had. */
  readonly seen: number;
}

/** What talking a case through gave. */
interface Talk {
  /** The thread; empty when none was started. */
  readonly threadId: string;
  /** How many runs it took. */
  readonly turns: number;
  /** Where the thread stood before. */
  readonly mark: Mark;
  /** How long it took, in milliseconds. */
  readonly durationMs: number;
  /** Why a run failed, when one did. */
  readonly error?: string;
}

/**
 * Talks a case through in its thread.
 *
 * @param world - The world.
 * @param alertBench - The bench.
 * @param alertCase - The case.
 * @returns The thread and how many runs the case took.
 */
async function talk(
  world: EvalWorld,
  alertBench: AlertBench,
  alertCase: AlertCase,
): Promise<{ threadId: string; turns: number }> {
  const threadId = threadOf(world, alertBench, alertCase);
  alertBench.threads.set(alertCase.id, threadId);
  await setLevel(world, alertBench.bench, alertCase.accessLevel);
  return { threadId, turns: await converse(world, threadId, alertCase) };
}

/**
 * A replay as the report keeps it: each series' firings, never its points.
 *
 * @param replay - The replay.
 * @returns The summary.
 */
function summaryOf(replay: AlertReplay): ReplaySummary {
  if (!replay.replayable) return replay;
  const series = replay.series.map((each) => ({
    labels: each.labels,
    firing: each.firing,
    tooShort: each.tooShort.length,
  }));
  return { replayable: true, series };
}

/**
 * Replays the latest version over the day before the run's clock, which holds the incident.
 *
 * @param world - The world.
 * @param written - The alert.
 * @returns The summary, or why it failed.
 */
async function replayOf(world: EvalWorld, written: Written): Promise<ReplaySummary> {
  const window = { from: evalsNow() - dayMs, to: evalsNow() };
  try {
    const { alertId, version } = written;
    return summaryOf(await world.services.alerts.replayVersion(alertId, version, window, 'editor'));
  } catch (failure) {
    return { replayable: false, reason: failure instanceof Error ? failure.message : 'unknown' };
  }
}

/**
 * The fingerprints of the panel a case starts from and of the alert, and the alert's links to
 * that panel.
 *
 * @param world - The world.
 * @param alertCase - The case.
 * @param written - The alert.
 * @returns The match, or nothing for a case that names no panel.
 */
function panelOf(world: EvalWorld, alertCase: AlertCase, written: Written): { panel?: PanelMatch } {
  const panel = fixture.panels.find((each) => each.id === alertCase.panelId);
  const [query] = panel?.queries ?? [];
  if (!query) return {};
  const links = world.services.panelLinks
    .forAlert(written.alertId, 'editor')
    .links.filter((link) => link.panelId === alertCase.panelId)
    .map((link) => link.how);
  const fingerprints = {
    panel: queryFingerprint(query as QueryTemplate),
    alert: queryFingerprint(written.spec.query as QueryTemplate),
  };
  return { panel: { ...fingerprints, links } };
}

/**
 * The model's tool calls in some messages, by tool name.
 *
 * @param messages - The messages.
 * @returns The counts.
 */
function toolCallsOf(messages: readonly StoredMessage[]): Record<string, number> {
  const calls: Record<string, number> = {};
  for (const part of messages.flatMap((message) => message.parts)) {
    if (!part.type.startsWith('tool-')) continue;
    const name = part.type.slice('tool-'.length);
    calls[name] = (calls[name] ?? 0) + 1;
  }
  return calls;
}

/**
 * What a message part adds to what the agent said: its text, or what a refused write reported, so
 * the report shows why a version was not saved.
 *
 * @param part - The part.
 * @param writeTool - The tool that writes the thread's alert or report, such as `edit_alert`.
 * @returns The lines.
 */
function saidIn(part: StoredMessage['parts'][number], writeTool: string): string[] {
  if (part.text) return [part.text];
  const output = (part as { output?: { ok?: boolean } }).output;
  if (part.type !== `tool-${writeTool}` || output?.ok !== false) return [];
  return [`[${writeTool} refused] ${JSON.stringify(output).slice(0, 600)}`];
}

/**
 * What the agent did and said in the messages of a case.
 *
 * @param messages - The case's messages.
 * @param writeTool - The tool that writes the thread's alert or report, such as `edit_alert`.
 * @returns The fields of the outcome they fill.
 */
export function conductOf(messages: readonly StoredMessage[], writeTool: string) {
  const { repairs, asked, usage } = tally(messages);
  const said = messages
    .filter((message) => message.role === 'assistant')
    .flatMap((message) => message.parts.flatMap((part) => saidIn(part, writeTool)))
    .join('\n')
    .slice(0, saidChars);
  return { repairs, asked, usage, said, toolCalls: toolCallsOf(messages) };
}

/**
 * What the alert holds: its spec, the versions the case saved, its replay, and its panel.
 *
 * @param world - The world.
 * @param alertCase - The case.
 * @param written - The alert, if the thread wrote one.
 * @param before - How many versions it had before the case.
 * @returns The fields of the outcome they fill.
 */
async function alertOf(
  world: EvalWorld,
  alertCase: AlertCase,
  written: Written | undefined,
  before: number,
) {
  if (!written) return { versions: 0 };
  const replay = await replayOf(world, written);
  const versions = written.count - before;
  return { spec: written.spec, versions, replay, ...panelOf(world, alertCase, written) };
}

/**
 * Talks the case a follow-up continues through first, when the run has not. Its outcome is not
 * reported.
 *
 * @param world - The world.
 * @param alertBench - The bench.
 * @param alertCase - The case.
 * @returns Once the case it follows has run.
 */
async function talkParent(
  world: EvalWorld,
  alertBench: AlertBench,
  alertCase: AlertCase,
): Promise<void> {
  const parent = alertCases.find((each) => each.id === alertCase.follows);
  if (parent && !alertBench.threads.has(parent.id)) await talk(world, alertBench, parent);
}

/**
 * Where the thread a case continues stands: nothing for a new thread.
 *
 * @param world - The world.
 * @param alertBench - The bench.
 * @param alertCase - The case.
 * @returns The mark.
 */
function markOf(world: EvalWorld, alertBench: AlertBench, alertCase: AlertCase): Mark {
  const previous = alertBench.threads.get(alertCase.follows ?? '');
  if (!previous) return { before: 0, seen: 0 };
  const before = writtenOf(world, previous)?.count ?? 0;
  return { before, seen: messagesOf(world, previous).length };
}

/**
 * Talks a case through, after the case it follows, and says where its thread stood before.
 *
 * @param world - The world.
 * @param alertBench - The bench.
 * @param alertCase - The case.
 * @returns The talk, with the error a run gave, if any.
 */
async function attempt(
  world: EvalWorld,
  alertBench: AlertBench,
  alertCase: AlertCase,
): Promise<Talk> {
  let mark: Mark = { before: 0, seen: 0 };
  let started = Date.now();
  try {
    await talkParent(world, alertBench, alertCase);
    mark = markOf(world, alertBench, alertCase);
    started = Date.now();
    const run = await talk(world, alertBench, alertCase);
    return { ...run, mark, durationMs: Date.now() - started };
  } catch (failure) {
    const threadId = alertBench.threads.get(alertCase.id) ?? '';
    const error = failure instanceof Error ? failure.message : String(failure);
    return { threadId, turns: 0, mark, durationMs: Date.now() - started, error };
  }
}

/**
 * Runs one alert case and reads what came of it.
 *
 * @param world - The world.
 * @param alertBench - The bench.
 * @param alertCase - The case.
 * @returns The outcome.
 */
export async function driveAlert(
  world: EvalWorld,
  alertBench: AlertBench,
  alertCase: AlertCase,
): Promise<AlertCaseOutcome> {
  const { threadId, turns, mark, durationMs, error } = await attempt(world, alertBench, alertCase);
  const messages = threadId ? messagesOf(world, threadId).slice(mark.seen) : [];
  const written = threadId ? writtenOf(world, threadId) : undefined;
  const incidentAt = incidentStart(new Date(evalsNow())).getTime();
  return {
    kind: 'alert',
    id: alertCase.id,
    channelIds: [world.channelId],
    incidentAt,
    ...(await alertOf(world, alertCase, written, mark.before)),
    ...conductOf(messages, 'edit_alert'),
    turns,
    durationMs,
    ...(error === undefined ? {} : { error }),
  };
}
