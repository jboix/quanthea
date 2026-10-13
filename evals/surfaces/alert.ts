/**
 * The alert surface: a thread that writes an alert. A case's turns are talked through, then the
 * alert's latest version is read and replayed over yesterday through the alerts service, and, for
 * a thread started from a panel, the fingerprints are compared and the links are read.
 */
import { incidentStart } from '@quanthea/dev/metrics/incident.ts';
import { queryFingerprint } from '@quanthea/server/src/alerts/fingerprint.ts';
import type { AlertReplay, AlertSpec, QueryTemplate } from '@quanthea/shared';
import type { AlertCaseOutcome, PanelMatch, ReplaySummary } from '../checks/alert.ts';
import type { Given, ThreadInput } from '../core/case.ts';
import type { Acted } from '../core/result.ts';
import { type EvalWorld, evalsActor, evalsNow } from '../world/setup.ts';
import { messagesOf, type StoredMessage, talk, tally, toolTrace } from './thread.ts';

/** How much of what the agent said the report keeps. */
const saidChars = 2000;

/** A day, in milliseconds: the replay covers the day before the run's clock. */
const dayMs = 86_400_000;

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
 * The fingerprints of the panel a thread started from and of the alert, and the alert's links to
 * that panel.
 *
 * @param world - The world.
 * @param threadId - The thread.
 * @param written - The alert.
 * @returns The match, or nothing for a thread that started from no panel.
 */
function panelOf(world: EvalWorld, threadId: string, written: Written): { panel?: PanelMatch } {
  const { seed } = world.services.threads.row(threadId);
  if (!seed) return {};
  const { spec } = world.services.dashboards.getVersion(seed.dashboardId, seed.version, 'editor');
  const [query] = spec.panels.find((each) => each.id === seed.panelId)?.queries ?? [];
  if (!query) return {};
  const links = world.services.panelLinks
    .forAlert(written.alertId, 'editor')
    .links.filter((link) => link.panelId === seed.panelId)
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
 * @param threadId - The thread.
 * @param before - How many versions the alert had before the case.
 * @returns The fields of the evidence they fill.
 */
async function alertOf(world: EvalWorld, threadId: string, before: number) {
  const written = writtenOf(world, threadId);
  if (!written) return { versions: 0 };
  const replay = await replayOf(world, written);
  const versions = written.count - before;
  return { spec: written.spec, versions, replay, ...panelOf(world, threadId, written) };
}

/**
 * Talks a case's turns through in an alert thread and reads what came of it.
 *
 * @param world - The world.
 * @param given - What the fixture left: an alert thread to continue, or nothing.
 * @param input - The turns.
 * @param id - The case's id.
 * @returns The evidence and the tool calls.
 */
export async function actAlert(
  world: EvalWorld,
  given: Given,
  input: ThreadInput,
  id: string,
): Promise<Acted<AlertCaseOutcome>> {
  const { threads } = world.services;
  const start = { kind: 'alert' as const, seed: undefined };
  const threadId = given.threadId ?? threads.create(evalsActor, null, undefined, start).id;
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
  const evidence: AlertCaseOutcome = {
    kind: 'alert',
    id,
    channelIds: [world.channelId],
    incidentAt: incidentStart(new Date(evalsNow())).getTime(),
    ...(await alertOf(world, threadId, before)),
    ...conductOf(messages, 'edit_alert'),
    turns,
    durationMs,
    ...(error === undefined ? {} : { error }),
  };
  return { evidence, toolCalls: toolTrace(messages) };
}
