/**
 * A run's report in words: one line per case, then the two headline numbers, what stands apart
 * from them, and what the numbers cost. Two reports side by side show what changed.
 */

import {
  type CaseResult,
  caseStatus,
  fractionOf,
  isUnstable,
  reasonsOf,
  type TrialResult,
} from '../core/result.ts';
import { skippedLine } from '../core/select.ts';
import { layoutCell, layoutLine } from './render-layout.ts';
import { parityLine } from './render-parity.ts';
import {
  cacheSentence,
  dollars,
  fractionWords,
  headlineOf,
  inBucket,
  madeOf,
  noiseFloor,
  type Report,
  statusWord,
  tokensOf,
  totalUsage,
  usageOf,
} from './report.ts';

/**
 * The trial a case's line shows: its first that did not pass, else its first.
 *
 * @param result - The case's results.
 * @returns The trial, if it has one.
 */
export function shownTrial(result: CaseResult): TrialResult | undefined {
  return result.trials.find((trial) => trial.status !== 'pass') ?? result.trials[0];
}

/**
 * Why a case did not pass, read on the trial its line shows.
 *
 * @param result - The case's results.
 * @returns The reasons, or the run's error; none for a pass.
 */
export function whyOf(result: CaseResult): string[] {
  const trial = shownTrial(result);
  if (!trial || trial.status === 'pass') return [];
  const { error } = trial.evidence;
  return error === undefined ? reasonsOf(trial) : [`the run failed: ${error}`];
}

/**
 * One line of the table.
 *
 * @param result - A case's results.
 * @returns The line.
 */
function line(result: CaseResult): string {
  const trial = shownTrial(result);
  const [made, spent] = trial ? madeOf(trial.evidence) : ['', ''];
  const seconds = result.trials.reduce((sum, each) => sum + each.evidence.durationMs, 0) / 1000;
  const cells = [
    result.id.padEnd(4),
    `${statusWord(caseStatus(result))} ${fractionWords(result)}`.trim().padEnd(6),
    made.padEnd(10),
    spent.padEnd(10),
    `${tokensOf(usageOf(result))} tokens`.padEnd(14),
    dollars(usageOf(result)).padEnd(10),
    `${Math.round(seconds)} s`.padEnd(6),
    layoutCell(trial?.layout).padEnd(10),
  ];
  return `${cells.join('  ')}  ${whyOf(result).join('; ')}`.trimEnd();
}

/**
 * A bucket's headline number, in words.
 *
 * @param name - The bucket's name, capitalised.
 * @param results - The bucket's results.
 * @returns Such as `Realistic: 9 of 17 pass, 1 for review`; nothing for an empty bucket.
 */
function bucketLine(name: string, results: readonly CaseResult[]): string[] {
  if (results.length === 0) return [];
  const { pass, of, review } = headlineOf(results);
  return [`${name}: ${pass} of ${of} pass${review > 0 ? `, ${review} for review` : ''}`];
}

/**
 * What stands apart from the headline numbers: the cases whose trials disagree, and those whose
 * run erred.
 *
 * @param results - The results.
 * @returns The lines; none when nothing stands apart.
 */
function apartLines(results: readonly CaseResult[]): string[] {
  const fraction = (result: CaseResult) => {
    const { pass, of } = fractionOf(result);
    return `${result.id} (${pass}/${of})`;
  };
  const unstable = results.filter(isUnstable).map(fraction);
  const erred = results.filter((result) => caseStatus(result) === 'error').map((each) => each.id);
  return [
    ...(unstable.length > 0 ? [`Unstable in this run: ${unstable.join(', ')}`] : []),
    ...(erred.length > 0 ? [`Errors, in no count: ${erred.join(', ')}`] : []),
  ];
}

/**
 * How the judge took part, in words.
 *
 * @param report - The report.
 * @returns The sentence.
 */
function judgeSentence(report: Report): string {
  const { judge } = report.versions;
  if (judge === null)
    return 'No judge read the rubrics: the patterns that stand in for them decided.';
  const { hits, misses, tokens = 0 } = report.judged;
  const spent = tokens > 0 ? ` for ${tokens.toLocaleString('en')} tokens` : '';
  return `The rubrics were read by ${judge}: ${misses} asked${spent}, ${hits} from its cache.`;
}

/**
 * The headline of a report: each bucket's number, how far a number moves by itself, what stands
 * apart, the number as scored before rubrics and results, and how the judge took part.
 *
 * @param report - The report.
 * @returns The lines.
 */
export function headlineLines(report: Report): string[] {
  const { results } = report;
  const realistic = inBucket(results, 'realistic');
  const noise = noiseFloor(headlineOf(realistic));
  const before = headlineOf(results, true);
  return [
    ...bucketLine('Capability', inBucket(results, 'capability')),
    ...bucketLine('Realistic', realistic),
    ...(noise > 0
      ? [`Noise: on the same code, the realistic count moves by about ${noise} between runs.`]
      : []),
    ...apartLines(results),
    ...((report.knownUnstable ?? []).length > 0
      ? [`Unstable in earlier trials: ${report.knownUnstable?.join(', ')}`]
      : []),
    `As scored before rubrics and results: ${before.pass} of ${before.of} pass`,
    judgeSentence(report),
  ];
}

/**
 * The report as a table, with the headline, the layout and parity scores when the run has them,
 * the cases it skipped, and what it cost.
 *
 * @param report - The report.
 * @returns The text.
 */
export function summary(report: Report): string {
  const usage = totalUsage(report.results);
  const { build, model } = report.models;
  const models = build ? `${model}, building with ${build}` : model;
  const parity = parityLine(report);
  const layouts = layoutLine(report.results.map((result) => shownTrial(result)?.layout));
  return [
    `Evals of ${report.startedAt} on ${models}`,
    '',
    ...report.results.map(line),
    '',
    ...headlineLines(report),
    ...(layouts === undefined ? [] : [layouts]),
    ...(parity === undefined ? [] : [parity]),
    ...(report.skipped ?? []).map(skippedLine),
    `${tokensOf(usage)} tokens · ${dollars(usage)} at list price`,
    cacheSentence(report.cache),
  ].join('\n');
}

/**
 * How one case changed from a report to the next. A case that is unstable in either says so, and
 * its change is not marked: it may be noise.
 *
 * @param before - Its results before, if it ran.
 * @param after - Its results after, if it ran.
 * @param known - Whether earlier trials showed the case unstable.
 * @returns The line.
 */
function change(
  before: CaseResult | undefined,
  after: CaseResult | undefined,
  known: boolean,
): string {
  const verdict = (result: CaseResult | undefined) =>
    result === undefined ? 'none' : statusWord(caseStatus(result));
  const tokens = (result: CaseResult | undefined) => (result ? tokensOf(usageOf(result)) : 0);
  const id = (before ?? after)?.id ?? '';
  const delta = tokens(after) - tokens(before);
  const unstable = known || [before, after].some((each) => each && isUnstable(each));
  // A case one of the runs left out did not change: it was not asked.
  const both = before !== undefined && after !== undefined;
  const changed = both && verdict(before) !== verdict(after) && !unstable ? '  <- changed' : '';
  const note = unstable ? '  (unstable)' : changed;
  return `${id.padEnd(4)}  ${verdict(before)} -> ${verdict(after)}  tokens ${delta >= 0 ? '+' : ''}${delta}${note}`;
}

/**
 * Two reports side by side: each case's status and tokens, then the totals.
 *
 * @param before - The earlier report.
 * @param after - The later report.
 * @returns The text.
 */
export function comparison(before: Report, after: Report): string {
  const ids = [...new Set([...before.results, ...after.results].map((result) => result.id))];
  const find = (report: Report, id: string) => report.results.find((result) => result.id === id);
  const passed = (report: Report) => headlineOf(report.results).pass;
  const listed = [...(before.knownUnstable ?? []), ...(after.knownUnstable ?? [])];
  const known = new Set(listed.map((each) => each.split(' ')[0]));
  return [
    `${before.startedAt} (${before.models.model}) -> ${after.startedAt} (${after.models.model})`,
    '',
    ...ids.map((id) => change(find(before, id), find(after, id), known.has(id))),
    '',
    `pass ${passed(before)} -> ${passed(after)} · cost ${dollars(totalUsage(before.results))} -> ${dollars(totalUsage(after.results))}`,
  ].join('\n');
}
