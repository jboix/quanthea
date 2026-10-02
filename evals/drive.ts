/**
 * Runs one question to its end, as a person would: asks it, answers the agent's question with its
 * first option (or the question's scripted answer), approves the plan, and lets the build run.
 * Then it reads what was built, runs the last version's queries again, and adds up what it cost.
 */
import { addUsage, type DashboardSpec, type TokenUsage, type TurnUsage } from '@quanthea/shared';
import type { Question } from './questions.ts';
import type { BuiltPanel, Outcome } from './score.ts';
import { type EvalWorld, evalsActor } from './setup.ts';

/** At most this many runs per question: the question, an answer, the build, a few more. */
const maxTurns = 6;

/** A part of a stored message, as the evals read it. */
interface StoredPart {
  /** The part's type, such as `text`, `tool-ask_person` or `data-repair`. */
  readonly type: string;
  /** A text part's text. */
  readonly text?: string;
  /** A tool call's input. */
  readonly input?: { readonly question?: string; readonly options?: readonly string[] };
  /** A data part's data. */
  readonly data?: { readonly outcome?: string };
}

/** A stored message, as the evals read it. */
interface StoredMessage {
  /** Its id. */
  readonly id: string;
  /** Who wrote it. */
  readonly role: string;
  /** Its parts. */
  readonly parts: readonly StoredPart[];
  /** Its metadata: an answer's usage. */
  readonly metadata?: { readonly usage?: TurnUsage };
}

/**
 * A person's message.
 *
 * @param text - What they say.
 * @param timeZone - Their time zone.
 * @returns The message.
 */
function userMessage(text: string, timeZone: string) {
  const parts = [{ type: 'text', text }];
  return { id: crypto.randomUUID(), role: 'user', parts, metadata: { mentions: [], timeZone } };
}

/**
 * The thread's messages, as the evals read them.
 *
 * @param world - The world.
 * @param threadId - The thread.
 * @returns The messages.
 */
function messagesOf(world: EvalWorld, threadId: string): StoredMessage[] {
  return world.services.threads.get(threadId).messages as StoredMessage[];
}

/**
 * What to send next: the approval's continuation, the answer to the agent's question (asked with
 * ask_person or in prose before any plan), or nothing when the thread is done or stuck.
 *
 * @param world - The world.
 * @param threadId - The thread.
 * @param question - The question, for its scripted answer and time zone.
 * @returns The next message, if any.
 */
function nextMessage(world: EvalWorld, threadId: string, question: Question): unknown {
  const thread = world.services.threads.get(threadId);
  const last = (thread.messages as StoredMessage[]).at(-1);
  if (last?.role !== 'assistant') return undefined;
  const pending = thread.plans.at(-1);
  if (thread.state === 'plan_pending' && pending?.status === 'pending') {
    world.services.threads.decidePlan(threadId, pending.id, 'approve', evalsActor);
    return { id: last.id, role: 'assistant', parts: [] };
  }
  const asked = last.parts.find((part) => part.type === 'tool-ask_person')?.input;
  if (asked)
    return userMessage(question.answer ?? asked.options?.[0] ?? 'Your pick.', question.timeZone);
  // A question asked in prose, while nothing is planned yet: a person would reply too.
  if (thread.state !== 'idle') return undefined;
  return userMessage(question.answer ?? 'Go ahead with what you think fits.', question.timeZone);
}

/**
 * The last version of the thread's dashboard, if it has one.
 *
 * @param world - The world.
 * @param threadId - The thread.
 * @returns Its spec.
 */
function lastSpec(world: EvalWorld, threadId: string): DashboardSpec | undefined {
  const { dashboardId } = world.services.threads.get(threadId);
  if (dashboardId === null) return undefined;
  const latest = world.services.dashboards.get(dashboardId, 'editor').versions.at(-1)?.version;
  if (latest === undefined) return undefined;
  return world.services.dashboards.getVersion(dashboardId, latest, 'editor').spec;
}

/**
 * A spec's panels, as the scoring reads them.
 *
 * @param spec - The spec.
 * @returns The panels.
 */
function panelsOf(spec: DashboardSpec | undefined): BuiltPanel[] {
  return (spec?.panels ?? []).map((panel) => ({
    id: panel.id,
    title: panel.title,
    connectors: [...new Set(panel.queries.map((query) => query.connector))],
    text: `${panel.title}\n${JSON.stringify(panel.queries)}`,
  }));
}

/**
 * A spec's markers, shaped like a panel for the scoring: their label and query.
 *
 * @param spec - The spec.
 * @returns The markers, if the spec has them.
 */
function markersOf(spec: DashboardSpec | undefined): BuiltPanel | undefined {
  const annotation = spec?.annotations.find((each) => each.id === 'markers');
  if (!annotation) return undefined;
  const title = `Markers: ${annotation.label}`;
  const text = `${title}\n${JSON.stringify([annotation.query])}`;
  return { id: 'markers', title, connectors: [annotation.query.connector], text };
}

/**
 * The outcome's markers field: the markers when the spec has them, else nothing.
 *
 * @param spec - The spec.
 * @returns The field to spread.
 */
function markersField(spec: DashboardSpec | undefined): { markers?: BuiltPanel } {
  const markers = markersOf(spec);
  return markers ? { markers } : {};
}

/**
 * The queries of the last version that fail when run again.
 *
 * @param world - The world.
 * @param spec - The last version.
 * @returns The failures, by panel.
 */
async function failingOf(world: EvalWorld, spec: DashboardSpec | undefined) {
  if (!spec) return [];
  const tests = await world.services.dashboards.testRun(spec);
  return tests.flatMap((test) =>
    test.run.queries.flatMap((query) =>
      query.error ? [{ panelId: test.panelId, error: query.error.message }] : [],
    ),
  );
}

/**
 * What the agent's answers did: the failed writes, its questions, and the tokens by model.
 *
 * @param messages - The thread's messages.
 * @returns The counts.
 */
function tally(messages: readonly StoredMessage[]) {
  const answers = messages.filter((message) => message.role === 'assistant');
  const parts = answers.flatMap((message) => message.parts);
  const repairs = parts.filter(
    (part) => part.type === 'data-repair' && part.data?.outcome !== 'repaired',
  ).length;
  const asked = parts.flatMap((part) =>
    part.type === 'tool-ask_person' && part.input?.question ? [part.input.question] : [],
  );
  let usage: TurnUsage = {};
  for (const answer of answers)
    for (const [model, tokens] of Object.entries(answer.metadata?.usage ?? {}))
      usage = addUsage(usage, model, tokens as TokenUsage);
  const said = answers
    .at(-1)
    ?.parts.flatMap((part) => (part.type === 'text' && part.text ? [part.text] : []));
  const lastWords = said?.join(' ').trim().slice(0, 600);
  return { repairs, asked, usage, ...(lastWords ? { lastWords } : {}) };
}

/**
 * The error a run streamed, if it streamed one: a run that fails, such as on a spent quota, ends
 * its stream with an error event rather than throwing.
 *
 * @param stream - The streamed events, as text.
 * @returns The error's text, if any.
 */
function streamError(stream: string): string | undefined {
  for (const line of stream.split('\n')) {
    if (!line.startsWith('data: {')) continue;
    const event = JSON.parse(line.slice('data: '.length)) as { type?: string; errorText?: string };
    if (event.type === 'error') return (event.errorText ?? '').replace(/^The run failed: /, '');
  }
  return undefined;
}

/**
 * Sends messages until the thread is built, stuck, or out of turns.
 *
 * @param world - The world.
 * @param threadId - The thread.
 * @param question - The question.
 * @returns How many runs it took.
 */
async function converse(world: EvalWorld, threadId: string, question: Question): Promise<number> {
  let message: unknown = userMessage(question.question, question.timeZone);
  let turns = 0;
  while (message !== undefined && turns < maxTurns) {
    const signal = AbortSignal.timeout(300_000);
    const response = await world.agent.chat({ threadId, message, actor: evalsActor, signal });
    const failed = streamError(await response.text());
    if (failed !== undefined) throw new Error(failed);
    turns += 1;
    message = nextMessage(world, threadId, question);
  }
  return turns;
}

/**
 * Asks one question and reads what came of it.
 *
 * @param world - The world.
 * @param question - The question.
 * @returns The outcome.
 */
export async function drive(world: EvalWorld, question: Question): Promise<Outcome> {
  const started = Date.now();
  const { id: threadId } = world.services.threads.create(evalsActor);
  let turns = 0;
  let error: string | undefined;
  try {
    turns = await converse(world, threadId, question);
  } catch (failure) {
    error = failure instanceof Error ? failure.message : String(failure);
  }
  const spec = lastSpec(world, threadId);
  const { state } = world.services.threads.get(threadId);
  const counted = tally(messagesOf(world, threadId));
  return {
    id: question.id,
    built: state === 'ready' && spec !== undefined,
    panels: panelsOf(spec),
    ...markersField(spec),
    failing: await failingOf(world, spec),
    turns,
    durationMs: Date.now() - started,
    ...counted,
    ...(error === undefined ? {} : { error }),
  };
}
