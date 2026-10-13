/**
 * The judge: a model that reads a case's rubric against what the case made, and answers each
 * sentence yes, no or uncertain, with a reason and what it bases it on. It never sees which
 * provider or model made the thing. A verdict is cached under everything the judge was sent, its
 * model and the version of its instructions, so the same thing is never judged twice, and a
 * changed sentence is judged again.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EvalCase, Evidence } from '../core/case.ts';
import type { Verdict, VerdictValue } from '../core/result.ts';
import type { RubricReader } from '../core/runner.ts';
import type { CacheCounts } from '../world/cache.ts';
import { judgeMaterial } from './material.ts';
import { judgeInstructions, judgePromptVersion, judgeQuestion } from './prompt.ts';

/** What the judge's model answered. */
export interface JudgeAnswer {
  /** Its answer, parsed from JSON; nothing when it wrote none. */
  readonly answer: unknown;
  /** The tokens the call spent, in and out. */
  readonly tokens: number;
}

/**
 * Asks the judge's model.
 *
 * @param instructions - What the judge is told.
 * @param question - What it is asked.
 * @returns What it answered, and what the call spent.
 */
export type AskJudge = (instructions: string, question: string) => Promise<JudgeAnswer>;

/** What a judge did in a run. */
export interface JudgeCounts extends CacheCounts {
  /** The tokens its calls spent, in and out. */
  tokens: number;
}

/** What a judge needs. */
export interface JudgeOptions {
  /** The judge's name in a report, such as `anthropic/claude-haiku-4-5`. */
  readonly label: string;
  /** Asks its model. */
  readonly ask: AskJudge;
  /** Where verdicts are kept. */
  readonly dir: string;
  /** The most calls to its model in a run. A rubric past it is left unjudged. */
  readonly budget: number;
  /** Which sample of the judge's answers to draw; 1 unless its own noise is measured. */
  readonly draw?: number | undefined;
}

/** A judge, with its name and what it did. */
export interface Judge extends RubricReader {
  /** Its name in a report. */
  readonly label: string;
  /** The verdicts that came from the cache, the calls to its model, and the tokens they spent. */
  readonly counts: JudgeCounts;
}

/** The answers a judge may give. */
const answers: readonly VerdictValue[] = ['yes', 'no', 'uncertain'];

/**
 * One verdict read from what the judge answered. An answer that is not one of the three, or is
 * missing, is uncertain: uncertainty never turns into a pass.
 *
 * @param sentence - The sentence.
 * @param given - The judge's entry for it, if it gave one.
 * @returns The verdict.
 */
function verdictOf(sentence: string, given: unknown): Verdict {
  const entry = (typeof given === 'object' && given !== null ? given : {}) as Record<
    string,
    unknown
  >;
  const answered = answers.find((each) => each === entry.verdict);
  const reason = typeof entry.reason === 'string' ? entry.reason : '';
  const evidence = typeof entry.evidence === 'string' ? entry.evidence.slice(0, 200) : '';
  if (!answered)
    return { sentence, verdict: 'uncertain', reason: 'the judge gave no usable answer', evidence };
  return { sentence, verdict: answered, reason, evidence };
}

/**
 * The verdicts read from what the judge answered, one per sentence, in order.
 *
 * @param rubric - The sentences.
 * @param answered - What the judge answered.
 * @returns The verdicts.
 */
export function readVerdicts(rubric: readonly string[], answered: unknown): Verdict[] {
  const list = (answered as { verdicts?: unknown } | null)?.verdicts;
  const entries = Array.isArray(list) ? list : [];
  return rubric.map((sentence, index) => verdictOf(sentence, entries[index]));
}

/**
 * Verdicts for a rubric the judge did not read.
 *
 * @param rubric - The sentences.
 * @param reason - Why.
 * @returns One skipped verdict per sentence.
 */
function unread(rubric: readonly string[], reason: string): Verdict[] {
  return rubric.map((sentence) => ({ sentence, verdict: 'skipped', reason, evidence: '' }));
}

/**
 * A judge.
 *
 * @param options - Its name, its model, where its verdicts are kept and its budget.
 * @returns The judge.
 */
export function createJudge(options: JudgeOptions): Judge {
  mkdirSync(options.dir, { recursive: true });
  const counts: JudgeCounts = { hits: 0, misses: 0, tokens: 0 };
  const pathOf = (question: string) => {
    const key = [options.label, judgePromptVersion, options.draw ?? 1, judgeInstructions, question];
    const hash = new Bun.CryptoHasher('sha256').update(JSON.stringify(key)).digest('hex');
    return join(options.dir, `${hash}.json`);
  };
  const judged = async (rubric: readonly string[], question: string): Promise<Verdict[]> => {
    const path = pathOf(question);
    if (existsSync(path)) {
      counts.hits += 1;
      return JSON.parse(readFileSync(path, 'utf8')) as Verdict[];
    }
    if (counts.misses >= options.budget) return unread(rubric, 'the judge’s budget is spent');
    counts.misses += 1;
    const { answer, tokens } = await options.ask(judgeInstructions, question);
    counts.tokens += tokens;
    const verdicts = readVerdicts(rubric, answer);
    writeFileSync(path, JSON.stringify(verdicts));
    return verdicts;
  };
  const read = async (evalCase: EvalCase, evidence: Evidence): Promise<Verdict[]> => {
    const rubric = evalCase.rubric ?? [];
    const question = judgeQuestion(judgeMaterial(evalCase, evidence), rubric);
    return judged(rubric, question).catch((failure) =>
      unread(rubric, `the judge failed: ${failure instanceof Error ? failure.message : failure}`),
    );
  };
  return { label: options.label, counts, read };
}
