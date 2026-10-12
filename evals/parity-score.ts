/**
 * Scores a parity question, and tells the questions the world can answer from those it must skip.
 * Pure, like the rest of the scoring.
 */
import {
  type Need,
  type ParityCase,
  type ParityExpectation,
  selectParityCases,
} from './parity-cases.ts';
import { type Outcome, type Score, score } from './score.ts';
import { holdsField } from './shape.ts';

/** A parity question that was not asked, and what the world lacks for it. */
export interface Skipped {
  /** The question's id. */
  readonly id: string;
  /** What the world does not have. */
  readonly needs: readonly Need[];
}

/** The parity questions of a run: those to ask, and those skipped. */
export interface ParityPlan {
  /** The questions the world can answer. */
  readonly ready: readonly ParityCase[];
  /** The questions that need something the world lacks. */
  readonly skipped: readonly Skipped[];
}

/**
 * What a question needs that the world does not have.
 *
 * @param parityCase - The question.
 * @param has - What the world has.
 * @returns The needs that are not met.
 */
function unmet(parityCase: ParityCase, has: readonly Need[]): Need[] {
  return (parityCase.expect.shape?.needs ?? []).filter((need) => !has.includes(need));
}

/**
 * Splits the parity questions into those the world can answer and those it must skip. A skipped
 * question is not asked and not scored, so it never counts as a failure.
 *
 * @param cases - The questions.
 * @param has - What the world has.
 * @returns The questions to ask, and those skipped with what they lack.
 */
export function planParity(cases: readonly ParityCase[], has: readonly Need[]): ParityPlan {
  const ready = cases.filter((each) => unmet(each, has).length === 0);
  const skipped = cases
    .filter((each) => !ready.includes(each))
    .map((each) => ({ id: each.id, needs: unmet(each, has) }));
  return { ready, skipped };
}

/**
 * The parity questions of a run: those `--only` names, split into those to ask and those skipped.
 *
 * @param only - The ids `--only` names.
 * @param has - What the world has.
 * @param search - Whether the run adds the search connector, which holds the player events.
 * @returns The questions to ask and those skipped.
 * @throws {Error} When a question is to be asked without the search connector.
 */
export function parityPlanOf(
  only: readonly string[],
  has: readonly Need[],
  search: boolean,
): ParityPlan {
  const plan = planParity(selectParityCases(only), has);
  if (plan.ready.length > 0 && !search)
    throw new Error('The parity questions are about the player events: add --search.');
  return plan;
}

/**
 * A skipped question, in words.
 *
 * @param skipped - The question and what it lacks.
 * @returns Such as `f23: skipped, the world has no http`.
 */
export function skippedLine(skipped: Skipped): string {
  return `${skipped.id}: skipped, the world has no ${skipped.needs.join(' and no ')}`;
}

/**
 * The fields the dashboard misses around its panels.
 *
 * @param outcome - What was built.
 * @param wanted - The fields expected, as paths.
 * @returns The reasons.
 */
function dashboardFaults(outcome: Outcome, wanted: readonly string[]): string[] {
  return wanted
    .filter((path) => !holdsField(outcome.dashboard, path))
    .map((path) => `the dashboard has no ${path}`);
}

/**
 * Scores a parity question's outcome: what any dashboard question is scored on, then the fields
 * the dashboard must hold around its panels.
 *
 * @param outcome - What the agent built.
 * @param expect - What a good answer holds.
 * @returns Pass or not, and why not.
 */
export function scoreParity(outcome: Outcome, expect: ParityExpectation): Score {
  const scored = score(outcome, expect);
  if (outcome.error !== undefined || !outcome.built) return scored;
  const reasons = [...scored.reasons, ...dashboardFaults(outcome, expect.dashboard ?? [])];
  return { pass: reasons.length === 0, reasons };
}
