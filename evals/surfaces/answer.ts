/**
 * The answer surfaces: a question on the Ask tab of a pinned dashboard, and a panel's explanation,
 * each made as its endpoint makes it, through the answering service. One service call per case.
 */
import type {
  AnswerMessage,
  AnswerOutcome,
  AskRequest,
  ExplainRequest,
} from '@quanthea/server/src/agent/answer-types.ts';
import type { PreparedExplanation } from '@quanthea/server/src/dashboards/explanations.ts';
import type { PreparedQuestion } from '@quanthea/server/src/dashboards/questions.ts';
import type { AnswerEvidence } from '@quanthea/shared';
import type { UIMessageStreamWriter } from 'ai';
import type { AnswerCaseOutcome, ReadSummary } from '../checks/answer.ts';
import type { AnswerInput, ExplanationInput, Given } from '../core/case.ts';
import type { Acted, TracedCall } from '../core/result.ts';
import { zurich } from '../world/incident.ts';
import { type EvalWorld, evalsActor } from '../world/setup.ts';
import { setLevel, traced } from './thread.ts';

/** How much of a read's result the report keeps. */
const resultChars = 400;

/** What the model did while it answered, from the stream it wrote. */
export interface Tally {
  /** The tool calls, by tool name. */
  readonly toolCalls: Record<string, number>;
  /** The model steps. */
  steps: number;
  /** Each tool call, in order, for the trace. */
  readonly calls: { tool: string; input: string; output: string; id: string }[];
}

/**
 * A tally with nothing counted yet.
 *
 * @returns The tally.
 */
export function newTally(): Tally {
  return { toolCalls: {}, steps: 0, calls: [] };
}

/**
 * The tool calls a tally holds, for the trace.
 *
 * @param tally - The tally.
 * @returns The calls, in order.
 */
export function tracedCalls(tally: Tally): TracedCall[] {
  return tally.calls.map(({ tool, input, output }) => ({ tool, input, output }));
}

/** A part of the stream the answering service writes, as far as the tally reads it. */
type StreamedPart = Parameters<UIMessageStreamWriter<AnswerMessage>['write']>[0];

/**
 * Keeps a tool call's input, or its output once it comes.
 *
 * @param tally - Where the calls go.
 * @param part - A part of the stream.
 */
function keepCall(tally: Tally, part: StreamedPart): void {
  if (part.type === 'tool-output-available') {
    const call = tally.calls.find((each) => each.id === part.toolCallId);
    if (call) call.output = traced(part.output);
  }
  if (part.type !== 'tool-input-available' && part.type !== 'tool-input-error') return;
  tally.toolCalls[part.toolName] = (tally.toolCalls[part.toolName] ?? 0) + 1;
  const call = { tool: part.toolName, input: traced(part.input), output: '' };
  tally.calls.push({ ...call, id: part.toolCallId });
}

/**
 * A writer that counts the model's steps and keeps its tool calls as the service streams them.
 *
 * @param tally - Where the counts and the calls go.
 * @returns The writer.
 */
export function countingWriter(tally: Tally): UIMessageStreamWriter<AnswerMessage> {
  return {
    write(part) {
      if (part.type === 'start-step') tally.steps += 1;
      keepCall(tally, part);
    },
    merge: () => undefined,
    onError: undefined,
  };
}

/**
 * A read, as the report keeps it: where and when it ran, and its result cut short.
 *
 * @param read - The read.
 * @returns The summary.
 */
export function summaryOf(read: AnswerEvidence): ReadSummary {
  const result = JSON.stringify(read.result) ?? '';
  const cut = result.length > resultChars ? `${result.slice(0, resultChars)}…` : result;
  const panel = read.panelId === undefined ? {} : { panelId: read.panelId };
  return { id: read.id, connector: read.connector, ...panel, time: read.time, result: cut };
}

/**
 * The answering service's request for a prepared question, as the question endpoint makes it.
 *
 * @param prepared - The question.
 * @returns The request.
 */
function askRequestOf(prepared: PreparedQuestion): AskRequest {
  const { dashboardId, spec, time, timeZone, variables, question, history } = prepared;
  const asked = { dashboardId, spec, time, timeZone, variables, question, history };
  return { ...asked, mode: 'ask', actor: evalsActor, signal: AbortSignal.timeout(300_000) };
}

/**
 * Asks a question as the question endpoint does, and stores it with its outcome.
 *
 * @param world - The world.
 * @param given - The pinned dashboard, and the question to follow up on, if any.
 * @param input - The question, the range and the time zone.
 * @param tally - Counts the steps and tool calls.
 * @returns The service's outcome.
 * @throws {Error} When the fixture left no dashboard.
 */
async function ask(
  world: EvalWorld,
  given: Given,
  input: AnswerInput,
  tally: Tally,
): Promise<AnswerOutcome> {
  const { questions } = world.services;
  const { dashboardId, parentQuestionId: parentId } = given;
  if (dashboardId === undefined) throw new Error('The fixture pinned no dashboard to ask about.');
  const [question] = input.turns;
  const { time, timeZone = zurich } = input;
  const shown = { variables: {}, hiddenMarkers: [], parentId };
  const prepared = questions.prepare(
    { dashboardId, version: 1, question, time, timeZone, ...shown },
    evalsActor,
  );
  const outcome = await world.answers.answer(askRequestOf(prepared), countingWriter(tally));
  questions.record(prepared, outcome);
  return outcome;
}

/**
 * The answering service's request for an explanation, as the explanation endpoint makes it: the
 * spec and the panel, nothing else.
 *
 * @param prepared - The explanation.
 * @returns The request.
 */
function explainRequestOf(prepared: PreparedExplanation): ExplainRequest {
  const { dashboardId, spec, panelId } = prepared;
  const signal = AbortSignal.timeout(300_000);
  return { mode: 'explain', dashboardId, spec, panelId, actor: evalsActor, signal };
}

/**
 * Asks for a panel's explanation as the explanation endpoint does, and stores it when it holds.
 *
 * @param world - The world.
 * @param given - The pinned dashboard.
 * @param input - The panel.
 * @param tally - Counts the steps and tool calls.
 * @returns The service's outcome.
 * @throws {Error} When the fixture left no dashboard.
 */
async function explain(
  world: EvalWorld,
  given: Given,
  input: ExplanationInput,
  tally: Tally,
): Promise<AnswerOutcome> {
  const { explanations } = world.services;
  if (given.dashboardId === undefined) throw new Error('The fixture pinned no dashboard.');
  const key = { dashboardId: given.dashboardId, version: 1, panelId: input.panel };
  const latest = explanations.latest(key, 'viewer').explanation?.id ?? null;
  const prepared = explanations.prepare(key, latest, evalsActor);
  try {
    const outcome = await world.answers.answer(explainRequestOf(prepared), countingWriter(tally));
    explanations.record(prepared, outcome);
    return outcome;
  } catch (error) {
    explanations.release(prepared);
    throw error;
  }
}

/**
 * The outcome the report keeps, from the service's.
 *
 * @param outcome - The service's outcome.
 * @returns The fields of the case's outcome it fills.
 */
function keptOf(outcome: AnswerOutcome) {
  if (!outcome.ok)
    return {
      ok: false,
      message: outcome.message,
      citations: [],
      evidence: outcome.evidence.map(summaryOf),
      usage: outcome.usage,
      // A failed call to the model is the provider's, not an answer the product gave.
      ...(outcome.ending === 'error' ? { error: outcome.message } : {}),
    };
  const { text, citations, evidence } = outcome.answer;
  return { ok: true, text, citations, evidence: evidence.map(summaryOf), usage: outcome.usage };
}

/**
 * Makes one call to the answering service at the case's access level, and reads what came of it.
 *
 * @param world - The world.
 * @param id - The case's id.
 * @param accessLevel - The access level every connector has while the case runs.
 * @param call - The call: a question or an explanation.
 * @returns The evidence and the tool calls.
 */
async function answered(
  world: EvalWorld,
  id: string,
  accessLevel: AnswerInput['accessLevel'],
  call: (tally: Tally) => Promise<AnswerOutcome>,
): Promise<Acted<AnswerCaseOutcome>> {
  const tally = newTally();
  const base = { kind: 'answer' as const, id };
  const counted = () => ({ toolCalls: tally.toolCalls, steps: tally.steps });
  const started = Date.now();
  try {
    await setLevel(world, accessLevel);
    const outcome = await call(tally);
    const evidence = {
      ...base,
      ...keptOf(outcome),
      ...counted(),
      durationMs: Date.now() - started,
    };
    return { evidence, toolCalls: tracedCalls(tally) };
  } catch (failure) {
    const error = failure instanceof Error ? failure.message : String(failure);
    const empty = { ok: false, citations: [], evidence: [], usage: {} };
    const evidence = { ...base, ...empty, ...counted(), durationMs: Date.now() - started, error };
    return { evidence, toolCalls: tracedCalls(tally) };
  }
}

/**
 * Asks a case's question about the pinned dashboard.
 *
 * @param world - The world.
 * @param given - The pinned dashboard, and the question to follow up on, if any.
 * @param input - The question.
 * @param id - The case's id.
 * @returns The evidence and the tool calls.
 */
export function actAnswer(
  world: EvalWorld,
  given: Given,
  input: AnswerInput,
  id: string,
): Promise<Acted<AnswerCaseOutcome>> {
  return answered(world, id, input.accessLevel, (tally) => ask(world, given, input, tally));
}

/**
 * Asks for the explanation of a panel of the pinned dashboard.
 *
 * @param world - The world.
 * @param given - The pinned dashboard.
 * @param input - The panel.
 * @param id - The case's id.
 * @returns The evidence and the tool calls.
 */
export function actExplanation(
  world: EvalWorld,
  given: Given,
  input: ExplanationInput,
  id: string,
): Promise<Acted<AnswerCaseOutcome>> {
  return answered(world, id, input.accessLevel, (tally) => explain(world, given, input, tally));
}
