/**
 * Runs the run cases as the endpoint of questions about a report's run does: sets the dev
 * connectors' access level, prepares each question on the run a report case made, follows up in
 * the same conversation, asks the answering service with the run's frozen results, and stores the
 * question with its outcome.
 */
import type { AnswerOutcome, AskRequest } from '@quanthea/server/src/agent/answer-types.ts';
import type { PreparedRunQuestion } from '@quanthea/server/src/reports/questions.ts';
import { addUsage, dashboardOfReport, type TokenUsage, type TurnUsage } from '@quanthea/shared';
import { countingWriter, setLevel, summaryOf, type Tally } from './answer-drive.ts';
import { type RunAnswerCase, reportCases } from './report-cases.ts';
import { driveReport, type MadeRun, type ReportBench } from './report-drive.ts';
import type { RunAnswer, RunAnswerCaseOutcome } from './run-answer-score.ts';
import { type EvalWorld, evalsActor } from './setup.ts';

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

/**
 * The run a case asks about: the one its report case made, made first when the run has not run
 * that case (its outcome is not reported).
 *
 * @param world - The world.
 * @param reportBench - The bench.
 * @param runCase - The case.
 * @returns The run.
 * @throws {Error} When the report case made no run.
 */
async function runOf(
  world: EvalWorld,
  reportBench: ReportBench,
  runCase: RunAnswerCase,
): Promise<MadeRun> {
  const parent = reportCases.find((each) => each.id === runCase.run);
  if (parent?.mode === 'write' && !reportBench.runs.has(parent.id))
    await driveReport(world, reportBench, parent);
  const made = reportBench.runs.get(runCase.run);
  if (!made) throw new Error(`${runCase.run} made no run to ask about.`);
  return made;
}

/** What asking a case's questions gave so far. */
interface Asked {
  /** The answers, in the order asked. */
  readonly answers: RunAnswer[];
  /** The tokens, over every answer. */
  usage: TurnUsage;
  /** The run's period, in words. */
  period?: string;
}

/**
 * Asks one question on the run, following up on the conversation when there is one, and stores
 * it with its outcome.
 *
 * @param world - The world.
 * @param target - The run, and the conversation to continue.
 * @param question - What to ask.
 * @param asked - Where the answer, the tokens and the period go.
 * @returns The conversation's id.
 */
async function askOne(
  world: EvalWorld,
  target: MadeRun & { conversationId?: string | undefined },
  question: string,
  asked: Asked,
): Promise<string> {
  const { runQuestions } = world.services;
  const prepared = runQuestions.prepare({ ...target, question }, evalsActor, 'editor');
  const tally: Tally = { toolCalls: {}, steps: 0 };
  const outcome = await world.answers.answer(askRequestOf(prepared), countingWriter(tally));
  runQuestions.record(prepared, outcome);
  asked.answers.push(keptOf(question, outcome, tally));
  for (const [model, tokens] of Object.entries(outcome.usage))
    asked.usage = addUsage(asked.usage, model, tokens as TokenUsage);
  asked.period = prepared.run.period.label;
  return prepared.rootId;
}

/**
 * Runs one run case and reads what came of it.
 *
 * @param world - The world.
 * @param reportBench - The bench.
 * @param runCase - The case.
 * @returns The outcome.
 */
export async function driveRunAnswer(
  world: EvalWorld,
  reportBench: ReportBench,
  runCase: RunAnswerCase,
): Promise<RunAnswerCaseOutcome> {
  const asked: Asked = { answers: [], usage: {} };
  let started = Date.now();
  let failure: string | undefined;
  try {
    const made = await runOf(world, reportBench, runCase);
    await setLevel(world, reportBench.bench, runCase.accessLevel);
    started = Date.now();
    let conversationId: string | undefined;
    for (const ask of runCase.asks)
      conversationId = await askOne(world, { ...made, conversationId }, ask.question, asked);
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }
  const { answers, usage, period } = asked;
  return {
    kind: 'run-answer',
    id: runCase.id,
    ...(period === undefined ? {} : { period }),
    answers,
    usage,
    durationMs: Date.now() - started,
    ...(failure === undefined ? {} : { error: failure }),
  };
}
