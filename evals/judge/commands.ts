/**
 * The commands that calibrate the judge. `--judge` reads the rubrics of a saved report and keeps
 * the verdicts beside it, with a list of sentences to label. `--calibrate` compares the verdicts
 * of judged reports with the maintainer's labels: how often the judge agrees, and how it is wrong.
 * A wrong pass (the judge says yes, the label no) is counted apart from a wrong failure: it makes
 * the product look better than it is.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { TrialResult, Verdict } from '../core/result.ts';
import { scoreTrial } from '../core/trial.ts';
import { caseOf, type Report, readReport } from '../report/report.ts';
import type { LiveJudge } from './live.ts';

/** The maintainer's verdict on one sentence of one trial of a judged report. */
export interface Label {
  /** When the report's run started: what names the report. */
  readonly report: string;
  /** The case. */
  readonly case: string;
  /** The trial's number. */
  readonly trial: number;
  /** The sentence, as the rubric wrote it. A sentence edited since has no label any more. */
  readonly sentence: string;
  /** What the maintainer says of it; `null` while it waits for them. */
  readonly label: 'yes' | 'no' | null;
  /** What the judge said, for the maintainer to read while labelling. */
  readonly judge?: string;
}

/** How a judge agrees with the labels of some verdicts. */
export interface Agreement {
  /** The labels whose trial and sentence a report holds, with a verdict the judge gave. */
  readonly labelled: number;
  /** The verdicts that say what the label says. */
  readonly agree: number;
  /** The verdicts that say yes where the label says no. */
  readonly wrongPass: number;
  /** The verdicts that say no where the label says yes. */
  readonly wrongFail: number;
  /** The verdicts that are uncertain. */
  readonly uncertain: number;
  /** The labels no report holds a verdict for: the report is not given, or the sentence changed. */
  readonly stale: number;
}

/**
 * The verdict a judged report holds for a label.
 *
 * @param reports - The judged reports.
 * @param label - The label.
 * @returns The verdict, if a report holds one the judge gave.
 */
function verdictFor(reports: readonly Report[], label: Label): Verdict | undefined {
  const report = reports.find((each) => each.startedAt === label.report);
  const trial = report?.results
    .find((result) => result.id === label.case)
    ?.trials.find((each) => each.trial === label.trial);
  const verdict = trial?.verdicts.find((each) => each.sentence === label.sentence);
  return verdict?.verdict === 'skipped' ? undefined : verdict;
}

/** How one verdict stands against its label. */
type Standing = 'agree' | 'wrongPass' | 'wrongFail' | 'uncertain' | 'other';

/**
 * How a verdict stands against a label.
 *
 * @param verdict - What the judge said.
 * @param label - What the maintainer says.
 * @returns Whether they agree, or how the judge is wrong or unsure.
 */
function standingOf(verdict: Verdict['verdict'], label: Label['label']): Standing {
  if (verdict === label) return 'agree';
  if (verdict === 'uncertain') return 'uncertain';
  if (verdict === 'yes') return 'wrongPass';
  return verdict === 'no' ? 'wrongFail' : 'other';
}

/**
 * How the verdicts of some judged reports agree with labels.
 *
 * @param reports - The judged reports.
 * @param labels - The labels; those not yet given are left out.
 * @returns The counts.
 */
export function agreement(reports: readonly Report[], labels: readonly Label[]): Agreement {
  const counts = { agree: 0, wrongPass: 0, wrongFail: 0, uncertain: 0, other: 0, stale: 0 };
  for (const label of labels.filter((each) => each.label !== null)) {
    const verdict = verdictFor(reports, label)?.verdict;
    counts[verdict === undefined ? 'stale' : standingOf(verdict, label.label)] += 1;
  }
  const { other: _other, stale, ...told } = counts;
  const labelled = Object.values(counts).reduce((sum, each) => sum + each, 0) - stale;
  return { labelled, ...told, stale };
}

/**
 * An agreement, in a line.
 *
 * @param name - Whose verdicts it counts, such as a provider.
 * @param counts - The counts.
 * @returns The line.
 */
function agreementLine(name: string, counts: Agreement): string {
  const { labelled, agree, wrongPass, wrongFail, uncertain, stale } = counts;
  const share = labelled === 0 ? 'no label' : `${Math.round((agree / labelled) * 100)}%`;
  return `${name}: agrees on ${agree} of ${labelled} (${share}); ${wrongPass} wrong passes, ${wrongFail} wrong failures, ${uncertain} uncertain, ${stale} stale labels`;
}

/**
 * Compares the verdicts of judged reports with the maintainer's labels, in all and by the provider
 * whose models made what was judged: the same agreement on both means the judge favours neither.
 *
 * @param reports - The judged reports.
 * @param dir - The folder of `labels.json`.
 * @returns The text.
 */
export function calibrate(reports: readonly Report[], dir: string): string {
  const labels = JSON.parse(readFileSync(join(dir, 'labels.json'), 'utf8')) as Label[];
  const providers = [...new Set(reports.map((report) => report.models.provider ?? 'google'))];
  const judges = [...new Set(reports.map((report) => report.versions.judge ?? 'no judge'))];
  const byProvider = providers.map((provider) => {
    const made = reports.filter((report) => (report.models.provider ?? 'google') === provider);
    const theirs = labels.filter((label) => made.some((each) => each.startedAt === label.report));
    return agreementLine(`made by ${provider}`, agreement(made, theirs));
  });
  return [
    `Judge: ${judges.join(', ')} · ${labels.length} labels in ${join(dir, 'labels.json')}`,
    agreementLine('in all', agreement(reports, labels)),
    ...byProvider,
    'About 30 labels tell a bad judge from a good one, within 10 to 15 points; not two good ones.',
  ].join('\n');
}

/**
 * Reads the rubric of one trial, when its case has one and the trial made something.
 *
 * @param id - The case's id.
 * @param trial - The trial.
 * @param live - The judge.
 * @returns The trial with the judge's verdicts, scored with them.
 */
async function judgedTrial(id: string, trial: TrialResult, live: LiveJudge): Promise<TrialResult> {
  const evalCase = caseOf(id);
  if (!evalCase) return trial;
  const readable = evalCase.rubric !== undefined && trial.evidence.error === undefined;
  const verdicts = readable ? await live.judge.read(evalCase, trial.evidence) : trial.verdicts;
  return scoreTrial(evalCase, trial, verdicts);
}

/**
 * Reads the rubric of every trial of a report that made something.
 *
 * @param report - The report.
 * @param live - The judge.
 * @returns The report with the judge's verdicts, scored with them.
 */
async function judged(report: Report, live: LiveJudge): Promise<Report> {
  const results = [];
  for (const result of report.results) {
    const trials: TrialResult[] = [];
    for (const trial of result.trials) trials.push(await judgedTrial(result.id, trial, live));
    results.push({ ...result, trials });
  }
  const versions = { ...report.versions, judge: live.judge.label };
  return { ...report, versions, judged: live.judge.counts, results };
}

/**
 * Every verdict of a judged report, as a label for the maintainer to fill.
 *
 * @param report - The judged report.
 * @returns The labels, none given yet.
 */
function labelsToFill(report: Report): Label[] {
  return report.results.flatMap((result) =>
    result.trials.flatMap((trial) =>
      trial.verdicts
        .filter((verdict) => verdict.verdict !== 'skipped')
        .map((verdict) => ({
          report: report.startedAt,
          case: result.id,
          trial: trial.trial,
          sentence: verdict.sentence,
          label: null,
          judge: `${verdict.verdict}: ${verdict.reason}`,
        })),
    ),
  );
}

/**
 * How many verdicts of two readings of the same report say the same.
 *
 * @param first - The first reading.
 * @param second - The second.
 * @returns The sentence.
 */
function selfAgreement(first: Report, second: Report): string {
  const key = (label: Label) => `${label.case}|${label.trial}|${label.sentence}`;
  const again = new Map(labelsToFill(second).map((label) => [key(label), label.judge]));
  const verdictOf = (text: string | undefined) => text?.split(':')[0];
  const all = labelsToFill(first);
  const same = all.filter((label) => verdictOf(again.get(key(label))) === verdictOf(label.judge));
  return `Read twice, the judge said the same on ${same.length} of ${all.length} sentences.`;
}

/**
 * Reads the rubrics of a saved report (`--judge`), keeps the judged report beside it and a list of
 * sentences to label, and with a second judge says how far the judge agrees with itself.
 *
 * @param path - The report's file.
 * @param judges - The judge, and the second reading's when asked for.
 * @param dir - The reports' folder.
 * @returns What happened, in words.
 * @throws {Error} When no judge could be opened.
 */
export async function judgeSaved(
  path: string,
  judges: readonly (LiveJudge | undefined)[],
  dir: string,
): Promise<string> {
  const [live, second] = judges;
  if (!live) throw new Error('The judge needs a key: set JUDGE_API_KEY.');
  try {
    const report = await judged(readReport(path), live);
    const name = basename(path).replace(/\.json$/, '');
    const out = join(dir, `${name}.judged.json`);
    writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
    const todo = join(dir, `${name}.labels.json`);
    writeFileSync(todo, `${JSON.stringify(labelsToFill(report), null, 2)}\n`);
    const twice = second ? [selfAgreement(report, await judged(readReport(path), second))] : [];
    const { hits, misses } = live.judge.counts;
    return [
      `Judged ${out}: ${misses} rubrics asked, ${hits} from the cache.`,
      `Sentences to label: ${todo}. Set "label" to "yes" or "no", then move them to evals/judge/labels.json.`,
      ...twice,
    ].join('\n');
  } finally {
    await live.close();
    await second?.close();
  }
}
