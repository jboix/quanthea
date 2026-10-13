/**
 * Talks a thread through as a person would: says each turn, answers the agent's question with its
 * first option (or the scripted reply), approves the plan, and lets the run end. Every surface
 * that is a thread uses it, and reads what the agent did from the stored messages.
 */
import { type AccessLevel, addUsage, type TokenUsage, type TurnUsage } from '@quanthea/shared';
import type { ThreadInput } from '../core/case.ts';
import type { TracedCall } from '../core/result.ts';
import { zurich } from '../world/incident.ts';
import { type EvalWorld, evalsActor } from '../world/setup.ts';
import type { AskedPanel, WriteOutput } from './asked.ts';

/** At most this many runs per turn: the turn, an answer, the build, a few more. */
const maxTurns = 6;

/** A part of a stored message, as the evals read it. */
interface StoredPart {
  /** The part's type, such as `text`, `tool-ask_person` or `data-repair`. */
  readonly type: string;
  /** A text part's text. */
  readonly text?: string;
  /** A tool call's input: a question to the person, or the panels of an edit. */
  readonly input?: {
    readonly question?: string;
    readonly options?: readonly string[];
    readonly panels?: readonly AskedPanel[];
  };
  /** What a write tool returned: whether it saved a version, and the panels it left out. */
  readonly output?: WriteOutput;
  /** A data part's data. */
  readonly data?: { readonly outcome?: string };
}

/** A stored message, as the evals read it. */
export interface StoredMessage {
  /** Its id. */
  readonly id: string;
  /** Who wrote it. */
  readonly role: string;
  /** Its parts. */
  readonly parts: readonly StoredPart[];
  /** Its metadata: an answer's usage. */
  readonly metadata?: { readonly usage?: TurnUsage };
}

/** How a person talks: what they answer the agent, and their time zone. */
interface Manner {
  /** How they answer a question of the agent; its first option when left out. */
  readonly reply?: string | undefined;
  /** Their time zone. */
  readonly timeZone: string;
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
export function messagesOf(world: EvalWorld, threadId: string): StoredMessage[] {
  return world.services.threads.get(threadId).messages as StoredMessage[];
}

/**
 * What to send next: the approval's continuation, the answer to the agent's question (asked with
 * ask_person or in prose before any plan), or nothing when the thread is done or stuck.
 *
 * @param world - The world.
 * @param threadId - The thread.
 * @param manner - How the person answers, and their time zone.
 * @returns The next message, if any.
 */
function nextMessage(world: EvalWorld, threadId: string, manner: Manner): unknown {
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
    return userMessage(manner.reply ?? asked.options?.[0] ?? 'Your pick.', manner.timeZone);
  // A question asked in prose, while nothing is planned yet: a person would reply too.
  if (thread.state !== 'idle') return undefined;
  return userMessage(manner.reply ?? 'Go ahead with what you think fits.', manner.timeZone);
}

/**
 * What the agent's answers did: the failed writes, its questions, and the tokens by model.
 *
 * @param messages - The thread's messages.
 * @returns The counts.
 */
export function tally(messages: readonly StoredMessage[]) {
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
 * Says one turn and sends messages until the thread is built, stuck, or out of runs.
 *
 * @param world - The world.
 * @param threadId - The thread.
 * @param turn - What the person says.
 * @param manner - How the person answers, and their time zone.
 * @returns How many runs it took.
 * @throws {Error} With the error a run streamed.
 */
async function converse(
  world: EvalWorld,
  threadId: string,
  turn: string,
  manner: Manner,
): Promise<number> {
  let message: unknown = userMessage(turn, manner.timeZone);
  let runs = 0;
  while (message !== undefined && runs < maxTurns) {
    const signal = AbortSignal.timeout(300_000);
    const response = await world.agent.chat({ threadId, message, actor: evalsActor, signal });
    const failed = streamError(await response.text());
    if (failed !== undefined) throw new Error(failed);
    runs += 1;
    message = nextMessage(world, threadId, manner);
  }
  return runs;
}

/**
 * Sets the access level of every connector of the world.
 *
 * @param world - The world.
 * @param accessLevel - The level; nothing changes when left out.
 * @returns Once every connector has it.
 */
export async function setLevel(
  world: EvalWorld,
  accessLevel: AccessLevel | undefined,
): Promise<void> {
  if (accessLevel === undefined) return;
  const { connections } = world.services;
  for (const { id } of connections.list())
    await connections.update(id, { accessLevel }, evalsActor);
}

/**
 * Talks a case's turns through in a thread, one after the other, at the case's access level.
 *
 * @param world - The world.
 * @param threadId - The thread.
 * @param input - The turns, the reply and the time zone.
 * @returns How many runs it took.
 * @throws {Error} With the error a run streamed.
 */
export async function talk(
  world: EvalWorld,
  threadId: string,
  input: ThreadInput,
): Promise<number> {
  await setLevel(world, input.accessLevel);
  const manner = { reply: input.reply, timeZone: input.timeZone ?? zurich };
  let runs = 0;
  for (const turn of input.turns) runs += await converse(world, threadId, turn, manner);
  return runs;
}

/** How much of a tool call's input or output a trace keeps. */
const tracedChars = 4000;

/**
 * A value as JSON, cut short.
 *
 * @param value - The value.
 * @returns The text; empty for nothing.
 */
export function traced(value: unknown): string {
  const text = value === undefined ? '' : (JSON.stringify(value) ?? '');
  return text.length > tracedChars ? `${text.slice(0, tracedChars)}…` : text;
}

/**
 * The model's tool calls in some messages, in order, for the trace.
 *
 * @param messages - The messages.
 * @returns The calls.
 */
export function toolTrace(messages: readonly StoredMessage[]): TracedCall[] {
  return messages
    .flatMap((message) => message.parts)
    .filter((part) => part.type.startsWith('tool-'))
    .map((part) => ({
      tool: part.type.slice('tool-'.length),
      input: traced(part.input),
      output: traced(part.output),
    }));
}
