/**
 * Runs the answer cases as the question and explanation endpoints do: the dev seed's checkout
 * incident dashboard is created and pinned once, each case sets the access level of both dev
 * connectors, then asks a question (stored, so a follow-up carries it as history) or asks for a
 * panel's explanation, through the answering service. One service call per case.
 */
import fixture from '@quanthea/dev/seed/checkout-incident.json' with { type: 'json' };
import type {
  AnswerMessage,
  AnswerOutcome,
  AskRequest,
  ExplainRequest,
} from '@quanthea/server/src/agent/answer-types.ts';
import type { PreparedExplanation } from '@quanthea/server/src/dashboards/explanations.ts';
import type { PreparedQuestion } from '@quanthea/server/src/dashboards/questions.ts';
import type { AccessLevel, AnswerEvidence } from '@quanthea/shared';
import type { UIMessageStreamWriter } from 'ai';
import { type AnswerCase, type AskCase, answerCases, type ExplainCase } from './answer-cases.ts';
import type { AnswerCaseOutcome, ReadSummary } from './answer-score.ts';
import { type EvalWorld, evalsActor } from './setup.ts';

/** How much of a read's result the report keeps. */
const resultChars = 400;

/** The pinned dashboard the cases answer about, and what the run asked of it so far. */
export interface AnswerBench {
  /** The dashboard; its version 1 is pinned. */
  readonly dashboardId: string;
  /** The dev connectors, whose access level each case sets. */
  readonly connectorIds: readonly string[];
  /** The stored question of each ask case asked so far, for follow-ups. */
  readonly asked: Map<string, string>;
}

/** What the model did while it answered, from the stream it wrote. */
interface Tally {
  /** The tool calls, by tool name. */
  readonly toolCalls: Record<string, number>;
  /** The model steps. */
  steps: number;
}

/**
 * Creates and pins the checkout incident dashboard of the dev seed.
 *
 * @param world - The world.
 * @returns The bench.
 */
export async function openBench(world: EvalWorld): Promise<AnswerBench> {
  const { dashboards, connections } = world.services;
  const { id } = dashboards.create(fixture, 'the dev seed', evalsActor);
  world.aliases.set(id, 'evals-dashboard');
  await dashboards.pin(id, 1, evalsActor);
  const connectorIds = connections.list().map((connector) => connector.id);
  return { dashboardId: id, connectorIds, asked: new Map() };
}

/**
 * Sets the access level of every dev connector.
 *
 * @param world - The world.
 * @param bench - The bench.
 * @param accessLevel - The level.
 * @returns Once every connector has it.
 */
export async function setLevel(
  world: EvalWorld,
  bench: AnswerBench,
  accessLevel: AccessLevel,
): Promise<void> {
  for (const id of bench.connectorIds)
    await world.services.connections.update(id, { accessLevel }, evalsActor);
}

/**
 * A writer that counts the model's steps and tool calls as the service streams them.
 *
 * @param tally - Where the counts go.
 * @returns The writer.
 */
function countingWriter(tally: Tally): UIMessageStreamWriter<AnswerMessage> {
  return {
    write(part) {
      if (part.type === 'start-step') tally.steps += 1;
      if (part.type !== 'tool-input-available' && part.type !== 'tool-input-error') return;
      tally.toolCalls[part.toolName] = (tally.toolCalls[part.toolName] ?? 0) + 1;
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
function summaryOf(read: AnswerEvidence): ReadSummary {
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
 * Asks an ask case's question as the question endpoint does, and stores it with its outcome.
 *
 * @param world - The world.
 * @param bench - The bench.
 * @param askCase - The case.
 * @param tally - Counts the steps and tool calls.
 * @returns The service's outcome.
 */
async function ask(
  world: EvalWorld,
  bench: AnswerBench,
  askCase: AskCase,
  tally: Tally,
): Promise<AnswerOutcome> {
  const { questions } = world.services;
  const { dashboardId } = bench;
  const parentId = askCase.follows === undefined ? undefined : bench.asked.get(askCase.follows);
  const { question, time, timeZone } = askCase;
  const shown = { variables: {}, hiddenMarkers: [], parentId };
  const prepared = questions.prepare(
    { dashboardId, version: 1, question, time, timeZone, ...shown },
    evalsActor,
  );
  const outcome = await world.answers.answer(askRequestOf(prepared), countingWriter(tally));
  questions.record(prepared, outcome);
  bench.asked.set(askCase.id, prepared.id);
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
 * Asks for an explain case's explanation as the explanation endpoint does, and stores it when it
 * holds.
 *
 * @param world - The world.
 * @param bench - The bench.
 * @param explainCase - The case.
 * @param tally - Counts the steps and tool calls.
 * @returns The service's outcome.
 */
async function explain(
  world: EvalWorld,
  bench: AnswerBench,
  explainCase: ExplainCase,
  tally: Tally,
): Promise<AnswerOutcome> {
  const { explanations } = world.services;
  const key = { dashboardId: bench.dashboardId, version: 1, panelId: explainCase.panelId };
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
 * Runs one case with its access level.
 *
 * @param world - The world.
 * @param bench - The bench.
 * @param answerCase - The case.
 * @param tally - Counts the steps and tool calls.
 * @returns The service's outcome.
 */
async function runCase(
  world: EvalWorld,
  bench: AnswerBench,
  answerCase: AnswerCase,
  tally: Tally,
): Promise<AnswerOutcome> {
  await setLevel(world, bench, answerCase.accessLevel);
  if (answerCase.mode === 'explain') return explain(world, bench, answerCase, tally);
  return ask(world, bench, answerCase, tally);
}

/**
 * Asks the case a follow-up follows first, when the run has not asked it yet. Its outcome is not
 * reported.
 *
 * @param world - The world.
 * @param bench - The bench.
 * @param answerCase - The case.
 * @returns Once the case it follows is asked.
 */
async function askParent(
  world: EvalWorld,
  bench: AnswerBench,
  answerCase: AnswerCase,
): Promise<void> {
  if (answerCase.mode !== 'ask' || answerCase.follows === undefined) return;
  if (bench.asked.has(answerCase.follows)) return;
  const parent = answerCases.find((each) => each.id === answerCase.follows);
  if (parent) await runCase(world, bench, parent, { toolCalls: {}, steps: 0 });
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
    };
  const { text, citations, evidence } = outcome.answer;
  return { ok: true, text, citations, evidence: evidence.map(summaryOf), usage: outcome.usage };
}

/**
 * Runs one answer case and reads what came of it.
 *
 * @param world - The world.
 * @param bench - The bench.
 * @param answerCase - The case.
 * @returns The outcome.
 */
export async function driveAnswer(
  world: EvalWorld,
  bench: AnswerBench,
  answerCase: AnswerCase,
): Promise<AnswerCaseOutcome> {
  const tally: Tally = { toolCalls: {}, steps: 0 };
  const base = { kind: 'answer' as const, id: answerCase.id };
  let started = Date.now();
  try {
    await askParent(world, bench, answerCase);
    started = Date.now();
    const outcome = await runCase(world, bench, answerCase, tally);
    return { ...base, ...keptOf(outcome), ...tally, durationMs: Date.now() - started };
  } catch (failure) {
    const error = failure instanceof Error ? failure.message : String(failure);
    const empty = { ok: false, citations: [], evidence: [], usage: {} };
    return { ...base, ...empty, ...tally, durationMs: Date.now() - started, error };
  }
}
