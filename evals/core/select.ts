/**
 * Which cases a run takes: those `--only` names, by id, by bucket or by the word for the parity
 * cases, split into those the world can run and those it must skip. A skipped case is not asked
 * and not scored, so it never counts as a failure.
 */
import type { EvalCase, Need } from './case.ts';

/** A case that was not run, and what the world lacks for it. */
export interface Skipped {
  /** The case's id. */
  readonly id: string;
  /** What the world does not have. */
  readonly needs: readonly Need[];
}

/** The cases of a run: those to run, and those skipped. */
export interface CasePlan {
  /** The cases the world can run. */
  readonly ready: readonly EvalCase[];
  /** The cases that need something the world lacks. */
  readonly skipped: readonly Skipped[];
}

/** The cases to choose from. */
export interface Catalogue {
  /** The cases a run takes when `--only` names none. */
  readonly defaults: readonly EvalCase[];
  /** The cases a run takes only when named. */
  readonly named: readonly EvalCase[];
  /** A word for every named case, such as `parity`. */
  readonly namedWord: string;
}

/**
 * Whether a word of `--only` names a case: its id, its bucket, or the word for the named cases.
 *
 * @param word - The word.
 * @param evalCase - The case.
 * @param catalogue - The cases to choose from.
 * @returns Whether it names it.
 */
function names(word: string, evalCase: EvalCase, catalogue: Catalogue): boolean {
  if (word === evalCase.id || word === evalCase.bucket) return true;
  return word === catalogue.namedWord && catalogue.named.includes(evalCase);
}

/**
 * The cases `--only` keeps, in their order.
 *
 * @param only - The words to keep by, or none for the default cases.
 * @param catalogue - The cases to choose from.
 * @returns The cases.
 * @throws {Error} When a word names no case.
 */
export function selectCases(only: readonly string[], catalogue: Catalogue): readonly EvalCase[] {
  if (only.length === 0) return catalogue.defaults;
  const all = [...catalogue.defaults, ...catalogue.named];
  const unknown = only.filter((word) => !all.some((each) => names(word, each, catalogue)));
  if (unknown.length > 0) throw new Error(`No case ${unknown.join(', ')}.`);
  return all.filter((each) => only.some((word) => names(word, each, catalogue)));
}

/**
 * Splits cases into those the world can run and those it must skip.
 *
 * @param cases - The cases.
 * @param has - What the world has.
 * @returns The cases to run, and those skipped with what they lack.
 */
export function planCases(cases: readonly EvalCase[], has: readonly Need[]): CasePlan {
  const unmet = (each: EvalCase) => (each.given.needs ?? []).filter((need) => !has.includes(need));
  const ready = cases.filter((each) => unmet(each).length === 0);
  const skipped = cases
    .filter((each) => !ready.includes(each))
    .map((each) => ({ id: each.id, needs: unmet(each) }));
  return { ready, skipped };
}

/** What the world lacks, in words, with what gives it when something does. */
const lacks: Readonly<Record<Need, string>> = {
  search: 'search connector (run with --search)',
  http: 'http connector',
  'pinned-target': 'pinned dashboard to link to',
};

/**
 * A skipped case, in words.
 *
 * @param skipped - The case and what it lacks.
 * @returns Such as `f23: skipped, the world has no http connector`.
 */
export function skippedLine(skipped: Skipped): string {
  const missing = skipped.needs.map((need) => lacks[need]);
  return `${skipped.id}: skipped, the world has no ${missing.join(' and no ')}`;
}
