/**
 * The run-answer surface: questions about a report's run, made as their endpoint makes them. Each
 * question is prepared on the run the fixture left, follows up on the one before in the same
 * conversation, is answered with the run's frozen results, and is stored with its outcome.
 */
import type { AnswerOutcome, AskRequest } from '@quanthea/server/src/agent/answer-types.ts';
import type { PreparedRunQuestion } from '@quanthea/server/src/reports/questions.ts';
import { addUsage, dashboardOfReport, type TokenUsage, type TurnUsage } from '@quanthea/shared';
import type { RunAnswer, RunAnswerCaseOutcome } from '../checks/run-answer.ts';
import type { Given, RunAnswerInput } from '../core/case.ts';
import type { Acted, TracedCall } from '../core/result.ts';
import { type EvalWorld, evalsActor } from '../world/setup.ts';
import { countingWriter, newTally, summaryOf, type Tally, tracedCalls } from './answer.ts';
import { setLevel } from './thread.ts';

/**
 * The answering service's request for a prepared question, as the endpoint makes it: the report's
 * panels over the run's period, and the run's frozen results.
 *
 * @param prepared - The question.
 * @returns The request.
 */
function askRequestOf(prepared: PreparedRunQuestion): AskRequest {
  const { run, question, history, timeZone } = prepared;
  const frozen = {
    label: run.period.label,
    comparison: run.comparison,
    panels: run.panels ?? {},
    comparisonPanels: run.comparisonPanels,
  };
  return {
    mode: 'ask',
    dashboardId: null,
    spec: dashboardOfReport(run.spec, run.period),
    time: { from: run.period.from, to: run.period.to },
    ...{ timeZone, variables: run.variables, question, history },
    run: frozen,
    actor: evalsActor,
    signal: AbortSignal.timeout(300_000),
  };
}

/**
 * An answer as the report keeps it.
 *
 * @param question - What was asked.
 * @param outcome - The service's outcome.
 * @param tally - The steps and tool calls.
 * @returns The answer.
 */
function keptOf(question: string, outcome: AnswerOutcome, tally: Tally): RunAnswer {
  const counted = { toolCalls: tally.toolCalls, steps: tally.steps };
  const evidence = (outcome.ok ? outcome.answer.evidence : outcome.evidence).map((read) => ({
    ...summaryOf(read),
    frozen: read.frozen === true,
  }));
  if (!outcome.ok)
    return {
      question,
      ok: false,
      message: [outcome.message, ...(outcome.issues ?? [])].join(' '),
      citations: [],
      evidence,
      followUps: [],
      ...counted,
    };
  const { text, citations, followUps } = outcome.answer;
  return { question, ok: true, text, citations, evidence, followUps: followUps ?? [], ...counted };
}

/** What asking a case's questions gave so far. */
interface Asked {
  /** The answers, in the order asked. */
  readonly answers: RunAnswer[];
  /** The tokens, over every answer. */
  usage: TurnUsage;
  /** The run's period, in words. */
  period?: string;
  /** Every tool call, in order, for the trace. */
  readonly calls: TracedCall[];
}

/**
 * Asks one question on the run, following up on the conversation when there is one, and stores
 * it with its outcome.
 *
 * @param world - The world.
 * @param target - The run, and the conversation to continue.
 * @param question - What to ask.
 * @param asked - Where the answer, the tokens, the period and the calls go.
 * @returns The conversation's id.
 */
async function askOne(
  world: EvalWorld,
  target: NonNullable<Given['run']> & { conversationId?: string | undefined },
  question: string,
  asked: Asked,
): Promise<string> {
  const { runQuestions } = world.services;
  const prepared = runQuestions.prepare({ ...target, question }, evalsActor, 'editor');
  const tally: Tally = newTally();
  const outcome = await world.answers.answer(askRequestOf(prepared), countingWriter(tally));
  runQuestions.record(prepared, outcome);
  // A failed call to the model is the provider's, not an answer the product gave.
  if (!outcome.ok && outcome.ending === 'error') throw new Error(outcome.message);
  asked.answers.push(keptOf(question, outcome, tally));
  asked.calls.push(...tracedCalls(tally));
  for (const [model, tokens] of Object.entries(outcome.usage))
    asked.usage = addUsage(asked.usage, model, tokens as TokenUsage);
  asked.period = prepared.run.period.label;
  return prepared.rootId;
}

/**
 * Asks a case's questions about the run the fixture left, and reads what came of them.
 *
 * @param world - The world.
 * @param given - The run.
 * @param input - The questions.
 * @param id - The case's id.
 * @returns The evidence and the tool calls.
 */
export async function actRunAnswer(
  world: EvalWorld,
  given: Given,
  input: RunAnswerInput,
  id: string,
): Promise<Acted<RunAnswerCaseOutcome>> {
  const asked: Asked = { answers: [], usage: {}, calls: [] };
  const started = Date.now();
  let failure: string | undefined;
  try {
    if (!given.run) throw new Error('The fixture left no run to ask about.');
    await setLevel(world, input.accessLevel);
    let conversationId: string | undefined;
    for (const question of input.turns)
      conversationId = await askOne(world, { ...given.run, conversationId }, question, asked);
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }
  const { answers, usage, period } = asked;
  const evidence: RunAnswerCaseOutcome = {
    kind: 'run-answer',
    id,
    ...(period === undefined ? {} : { period }),
    answers,
    usage,
    durationMs: Date.now() - started,
    ...(failure === undefined ? {} : { error: failure }),
  };
  return { evidence, toolCalls: asked.calls };
}
