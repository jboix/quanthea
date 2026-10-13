/**
 * A run's report in evalmark's result format, so the Evals workflow can record it: each case with
 * its trials, each check and rubric sentence as a check, and a transcript of what the person
 * asked, the tools the agent called and what it said last. The provider and models are its labels,
 * and the bucket and the surface of a case its tags. A case that was skipped has a skipped trial,
 * and so has a trial that waits for review: evalmark shows neither as a pass or a failure.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { costOf, type TurnUsage } from '@quanthea/shared';
import type { Case, CheckResult, Result as EvalmarkResult, Message, Trial } from 'evalmark';
import { askOf, type EvalCase, type Evidence } from '../core/case.ts';
import type { CaseResult, TrialResult } from '../core/result.ts';
import { type Skipped, skippedLine } from '../core/select.ts';
import { caseOf, type Report } from './report.ts';

/** The evalmark status of each status a trial can have. */
const statuses = { pass: 'pass', fail: 'fail', error: 'error', review: 'skip' } as const;

/**
 * The tokens and money of a usage, as evalmark counts them.
 *
 * @param usage - The usage, by model.
 * @returns Input tokens (fresh, cached and written), output tokens, and the cost at list price.
 */
function usageOf(usage: TurnUsage): NonNullable<Trial['usage']> {
  const all = Object.values(usage);
  const sum = (pick: (tokens: (typeof all)[number]) => number) =>
    all.reduce((total, tokens) => total + pick(tokens), 0);
  return {
    inputTokens: sum((tokens) => tokens.input + tokens.cachedInput + tokens.cacheWrite),
    outputTokens: sum((tokens) => tokens.output),
    costUsd: costOf(usage).dollars,
  };
}

/**
 * What the agent said last: a dashboard thread's last words, an answer's text, or what an alert
 * or a report thread said.
 *
 * @param outcome - What the trial made.
 * @returns The text, if there is one.
 */
function finalWords(outcome: Evidence): string | undefined {
  if ('lastWords' in outcome && outcome.lastWords) return outcome.lastWords;
  if ('text' in outcome && typeof outcome.text === 'string') return outcome.text;
  if ('said' in outcome && outcome.said) return outcome.said;
  return undefined;
}

/**
 * A trial's checks as evalmark's: every check that ran, then every sentence the judge answered.
 *
 * @param trial - The trial.
 * @returns The checks.
 */
function checksOf(trial: TrialResult): CheckResult[] {
  const ran = trial.checks
    .filter((check) => check.outcome !== 'skipped')
    .map((check) => ({
      id: check.id,
      pass: check.outcome === 'pass',
      ...(check.message ? { message: check.message } : {}),
    }));
  const judged = trial.verdicts
    .filter((verdict) => verdict.verdict !== 'skipped')
    .map((verdict) => ({
      id: `rubric: ${verdict.sentence}`,
      pass: verdict.verdict === 'yes',
      message: verdict.reason,
    }));
  return [...ran, ...judged];
}

/**
 * A transcript: what the person asked, what the agent asked back, the tools it called, and what
 * it said last.
 *
 * @param question - What the person asked, if the case is known.
 * @param trial - The trial.
 * @returns The messages.
 */
function transcriptOf(question: string | undefined, trial: TrialResult): Message[] {
  const messages: Message[] = question === undefined ? [] : [{ role: 'user', content: question }];
  const { evidence, trace } = trial;
  for (const content of 'asked' in evidence ? evidence.asked : [])
    messages.push({ role: 'assistant', content });
  const toolCalls = trace.toolCalls.map((call) => ({
    name: call.tool,
    input: call.input,
    output: call.output,
  }));
  const last = finalWords(evidence);
  if (toolCalls.length > 0 || last !== undefined)
    messages.push({ role: 'assistant', ...(last ? { content: last } : {}), toolCalls });
  return messages;
}

/**
 * One trial, as evalmark's.
 *
 * @param question - What the person asked, if the case is known.
 * @param trial - The trial.
 * @returns The trial.
 */
function trialOf(question: string | undefined, trial: TrialResult): Trial {
  const { evidence } = trial;
  const output = finalWords(evidence);
  const review = trial.status === 'review' ? { error: 'for review: the judge was unsure' } : {};
  return {
    status: statuses[trial.status],
    durationMs: evidence.durationMs,
    usage: usageOf(evidence.usage),
    checks: checksOf(trial),
    ...(evidence.error ? { error: evidence.error } : review),
    ...(output === undefined ? {} : { output }),
    transcript: transcriptOf(question, trial),
  };
}

/**
 * A case's tags: its surface, its bucket, and `parity` for a case of a family of panels.
 *
 * @param evalCase - The case.
 * @returns The tags.
 */
function tagsOf(evalCase: EvalCase): string[] {
  const parity = evalCase.family === undefined ? [] : ['parity'];
  return [evalCase.input.surface, evalCase.bucket, ...parity];
}

/**
 * A case with its trials, as evalmark's.
 *
 * @param result - The case's results.
 * @returns The case.
 */
function ranCase(result: CaseResult): Case {
  const evalCase = caseOf(result.id);
  const question = evalCase ? askOf(evalCase) : undefined;
  return {
    id: result.id,
    title: question === undefined ? result.id : `${result.id}: ${question}`,
    ...(question === undefined ? {} : { input: question }),
    tags: evalCase ? tagsOf(evalCase) : [result.surface, result.bucket],
    trials: result.trials.map((trial) => trialOf(question, trial)),
  };
}

/**
 * A case that was not run, as evalmark's: one skipped trial, with what the world lacks.
 *
 * @param skipped - The case and what it lacks.
 * @returns The case.
 */
function skippedCase(skipped: Skipped): Case {
  const evalCase = caseOf(skipped.id);
  const question = evalCase ? askOf(evalCase) : undefined;
  return {
    id: skipped.id,
    title: question === undefined ? skipped.id : `${skipped.id}: ${question}`,
    ...(question === undefined ? {} : { input: question }),
    ...(evalCase ? { tags: tagsOf(evalCase) } : {}),
    trials: [{ status: 'skip', output: skippedLine(skipped) }],
  };
}

/**
 * The report as an evalmark result.
 *
 * @param report - The report.
 * @returns The result.
 */
export function evalmarkResult(report: Report): EvalmarkResult {
  const { provider = 'google', model, build } = report.models;
  return {
    $schema: 'https://jboix.github.io/evalmark/schema/result.v1.json',
    version: 1,
    suite: 'quanthea',
    startedAt: report.startedAt,
    labels: { provider, model: build ?? model, 'talk-model': model },
    cases: [...report.results.map(ranCase), ...(report.skipped ?? []).map(skippedCase)],
  };
}

/**
 * Writes the report as an evalmark result, for the Evals workflow to record.
 *
 * @param dir - The reports' folder.
 * @param report - The report.
 * @returns The file's path.
 */
export function writeEvalmark(dir: string, report: Report): string {
  const path = join(dir, 'evalmark.json');
  writeFileSync(path, `${JSON.stringify(evalmarkResult(report), null, 2)}\n`);
  return path;
}
