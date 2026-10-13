/**
 * Runs a case: for each trial, a world of its own, the case's fixture, its one act, the truths its
 * checks compare with, then the checks and the judge. A trial that errs is run once more, since an
 * outage is not a failure of the product.
 */
import { act, checksOf, erred } from '../surfaces/index.ts';
import type { CacheCounts, Draw } from '../world/cache.ts';
import { type EvalModels, type EvalWorld, evalsNow, openWorld } from '../world/setup.ts';
import type { EvalCase, Evidence, Truth } from './case.ts';
import type { Acted, CaseResult, TracedCall, TrialResult, Verdict } from './result.ts';
import { worthJudging } from './score.ts';
import { checked, type Ran, scoreTrial, unjudged } from './trial.ts';

/** Reads a rubric against what a case made. */
export interface RubricReader {
  /**
   * Answers each sentence of a case's rubric.
   *
   * @param evalCase - The case.
   * @param evidence - What it made.
   * @returns One verdict per sentence, in order.
   */
  read(evalCase: EvalCase, evidence: Evidence): Promise<Verdict[]>;
}

/** What every trial of a run shares. */
export interface RunSetup {
  /** The models. */
  readonly models: EvalModels;
  /** The provider's key, if there is one; without it, only cached responses play. */
  readonly apiKey: string | undefined;
  /** Where the response cache is, whether to read it, and the spacing of live calls. */
  readonly cache: { readonly dir: string; readonly read: boolean; readonly minIntervalMs: number };
  /** Whether every world has the search connector. */
  readonly search: boolean;
  /** How many trials each case gets. */
  readonly trials: number;
  /** The name of the sample set; empty for the unnamed one. */
  readonly sample: string;
  /** The judge, when one reads the rubrics. */
  readonly judge?: RubricReader | undefined;
  /** When the last live call started, shared by every world of the run. */
  readonly pacing: { last: number };
  /** The cache's hits and misses over the whole run. */
  readonly counts: CacheCounts;
}

/** What one attempt at a trial gave. */
interface Attempt {
  /** What the case made, and its tool calls. */
  readonly acted: Acted<Evidence>;
  /** The truths its checks compare with, by key. */
  readonly truth: Record<string, unknown>;
  /** The cache's hits and misses of the attempt. */
  readonly cache: CacheCounts;
}

/**
 * The truths the checks of a case compare with, each once.
 *
 * @param evalCase - The case.
 * @returns The truths.
 */
function truthsOf(evalCase: EvalCase): Truth[] {
  const byKey = new Map<string, Truth>();
  for (const check of checksOf(evalCase))
    for (const truth of check.truths ?? []) byKey.set(truth.key, truth);
  return [...byKey.values()];
}

/**
 * Computes the truths of a case at the run's clock. One that cannot be computed is kept as null,
 * and the check that needs it says so.
 *
 * @param evalCase - The case.
 * @param evidence - What it made.
 * @returns The truths, by key.
 */
async function computeTruths(
  evalCase: EvalCase,
  evidence: Evidence,
): Promise<Record<string, unknown>> {
  const truth: Record<string, unknown> = {};
  if (evidence.error !== undefined) return truth;
  for (const each of truthsOf(evalCase)) {
    // A truth that could not be computed is kept as null: its check fails and says so.
    truth[each.key] = (await each.compute(evalsNow(), evidence).catch(() => null)) ?? null;
  }
  return truth;
}

/**
 * Arranges and acts in a world: the fixture, then the case's input on its surface.
 *
 * @param world - The world.
 * @param evalCase - The case.
 * @returns What the case made; an error as evidence when the fixture or the act threw.
 */
async function arrangeAndAct(world: EvalWorld, evalCase: EvalCase): Promise<Acted<Evidence>> {
  try {
    const given = await evalCase.given.prepare(world);
    return await act(world, given, evalCase);
  } catch (failure) {
    const error = failure instanceof Error ? failure.message : String(failure);
    return { evidence: erred(evalCase, error), toolCalls: [] as TracedCall[] };
  }
}

/**
 * One attempt at a trial, in a world of its own.
 *
 * @param evalCase - The case.
 * @param setup - What every trial shares.
 * @param draw - The sample this trial draws.
 * @returns What it gave.
 */
async function attempt(evalCase: EvalCase, setup: RunSetup, draw: Draw): Promise<Attempt> {
  const cache = { ...setup.cache, draw, pacing: setup.pacing };
  const world = await openWorld(setup.models, setup.apiKey, cache, { search: setup.search });
  try {
    const acted = await arrangeAndAct(world, evalCase);
    const truth = await computeTruths(evalCase, acted.evidence);
    return { acted, truth, cache: { ...world.counts } };
  } finally {
    await world.close();
    setup.counts.hits += world.counts.hits;
    setup.counts.misses += world.counts.misses;
  }
}

/**
 * The verdicts of a trial's rubric: the judge's, when there is one and no check already failed.
 *
 * @param evalCase - The case.
 * @param ran - What the trial gave.
 * @param judge - The judge, if any.
 * @returns One verdict per sentence.
 */
async function verdictsOf(
  evalCase: EvalCase,
  ran: Ran,
  judge: RubricReader | undefined,
): Promise<Verdict[]> {
  if ((evalCase.rubric ?? []).length === 0) return [];
  if (!judge) return unjudged(evalCase, 'the run had no judge');
  if (!worthJudging(ran.evidence.error, checked(evalCase, ran)))
    return unjudged(evalCase, 'a check failed before the judge');
  return judge.read(evalCase, ran.evidence);
}

/**
 * Runs one trial of a case, once more when it errs.
 *
 * @param evalCase - The case.
 * @param setup - What every trial shares.
 * @param trial - The trial's number, from 1.
 * @returns The trial's result.
 */
export async function runTrial(
  evalCase: EvalCase,
  setup: RunSetup,
  trial: number,
): Promise<TrialResult> {
  const draw = { sample: setup.sample, trial };
  let made = await attempt(evalCase, setup, draw);
  let retries = 0;
  if (made.acted.evidence.error !== undefined) {
    retries = 1;
    made = await attempt(evalCase, setup, draw);
  }
  const trace = { toolCalls: made.acted.toolCalls, cache: made.cache, retries };
  const ran: Ran = { trial, evidence: made.acted.evidence, truth: made.truth, trace };
  return scoreTrial(evalCase, ran, await verdictsOf(evalCase, ran, setup.judge));
}

/**
 * Runs every trial of a case, one after the other.
 *
 * @param evalCase - The case.
 * @param setup - What every trial shares.
 * @param onTrial - Told each trial's result as it comes.
 * @returns The case's results.
 */
export async function runCase(
  evalCase: EvalCase,
  setup: RunSetup,
  onTrial: (trial: TrialResult) => void = () => undefined,
): Promise<CaseResult> {
  const trials: TrialResult[] = [];
  for (let trial = 1; trial <= setup.trials; trial += 1) {
    const result = await runTrial(evalCase, setup, trial);
    trials.push(result);
    onTrial(result);
  }
  return { id: evalCase.id, bucket: evalCase.bucket, surface: evalCase.input.surface, trials };
}
