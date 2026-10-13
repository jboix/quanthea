/**
 * `bun run evals`: runs the eval cases against the dev data and scores what the agent makes. It
 * needs the data sources (`bun run env:up`, and `bun run env:up:search` with `--search`) and the
 * provider's key, except for what the response cache already holds. It is never part of
 * `bun run verify`.
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { staleDataReason } from '@quanthea/dev/freshness.ts';
import { waitForFirstScrape } from '@quanthea/server/src/connectors/_shared/test/dev-sources.ts';
import { defaultCases, namedCases } from './cases/index.ts';
import { parityWord } from './cases/parity.ts';
import type { EvalCase } from './core/case.ts';
import { type CaseResult, caseStatus, type TrialResult } from './core/result.ts';
import { type RunSetup, runCase } from './core/runner.ts';
import { planCases, selectCases, skippedLine } from './core/select.ts';
import { record } from './fixtures/record.ts';
import { calibrate, judgeSaved } from './judge/commands.ts';
import type { Judge } from './judge/judge.ts';
import { defaultJudge, type LiveJudge, openLiveJudge } from './judge/live.ts';
import { judgePromptVersion } from './judge/prompt.ts';
import { writeEvalmark } from './report/evalmark.ts';
import { htmlReport, markdownReport } from './report/render.ts';
import { type Report, readReport, rescore, statusWord, writeReport } from './report/report.ts';
import { comparison, summary } from './report/summary.ts';
import { knownUnstable, observed, readBook, writeBook } from './report/unstable.ts';
import { usage } from './usage.ts';
import {
  apiKeyOf,
  type EvalProvider,
  keyVariableOf,
  providerOf,
  suggestedModels,
} from './world/providers.ts';
import { type EvalModels, evalsNow, waitForEvents } from './world/setup.ts';

const here = import.meta.dir;
const reportsDir = join(here, 'reports');
const bookPath = join(here, 'unstable.json');

/** The most calls to the judge's model in a run. */
const judgeBudget = 300;

/**
 * Reads the flags.
 *
 * @returns The flags and the positional arguments.
 */
function readFlags() {
  const text = { type: 'string' } as const;
  const yes = { type: 'boolean' } as const;
  const options = {
    only: text,
    provider: text,
    model: text,
    'build-model': text,
    search: yes,
    trials: text,
    sample: text,
    'no-judge': yes,
    'judge-provider': text,
    'judge-model': text,
    'no-cache': yes,
    'allow-failures': text,
    rescore: text,
    compare: yes,
    judge: text,
    twice: yes,
    calibrate: yes,
    record: text,
    help: yes,
  } as const;
  return parseArgs({ args: process.argv.slice(2), options, allowPositionals: true });
}

/** The flags, as read. */
type Flags = ReturnType<typeof readFlags>['values'];

/**
 * Keeps a report: JSON to score again, an HTML page to read, the evalmark result the Evals
 * workflow records, and in GitHub Actions the job's summary page.
 *
 * @param report - The report.
 * @returns The HTML page's path.
 */
function publish(report: Report): string {
  const json = writeReport(reportsDir, report);
  const html = json.replace(/\.json$/, '.html');
  writeFileSync(html, htmlReport(report));
  writeEvalmark(reportsDir, report);
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) appendFileSync(summaryFile, markdownReport(report));
  return html;
}

/**
 * The exit code for a report: an error when more cases fail than allowed. Without a limit,
 * failing cases are what the report shows, never an error: a model's answers vary.
 *
 * @param report - The report.
 * @param allowed - How many cases may fail, or `undefined` for no limit.
 * @returns The exit code.
 */
function exitCodeOf(report: Report, allowed: number | undefined): number {
  if (allowed === undefined) return 0;
  const failed = report.results.filter((result) => caseStatus(result) === 'fail').length;
  if (failed <= allowed) return 0;
  process.stderr.write(
    `${failed} ${failed === 1 ? 'case fails' : 'cases fail'}, more than the ${allowed} allowed.\n`,
  );
  return 1;
}

/**
 * Checks the dev data sources: they answer, and their incident is yesterday's. With the search
 * connector, the dev OpenSearch answers too and holds player events of today.
 *
 * @param search - Whether the run adds the search connector.
 * @returns Once they are ready.
 * @throws {Error} With the advice to start or seed them again.
 */
async function checkSources(search: boolean): Promise<void> {
  await waitForFirstScrape().catch(() => {
    throw new Error('The dev data sources do not answer. Start them with bun run env:up.');
  });
  const stale = await staleDataReason(new Date());
  if (stale) throw new Error(stale);
  if (search) await waitForEvents();
}

/**
 * The run's provider and models: the flags, or else the models quanthea suggests for the provider.
 *
 * @param flags - The flags.
 * @returns The models.
 */
function modelsOf(flags: Flags): EvalModels {
  const provider = providerOf(flags.provider);
  const suggested = suggestedModels(provider);
  const model = flags.model ?? suggested.model;
  // A model given alone runs every job, as before; without one, the suggested pair runs.
  const build = flags['build-model'] ?? (flags.model === undefined ? suggested.build : undefined);
  return { provider, model, build };
}

/**
 * The provider's key of a run, with a note when there is none.
 *
 * @param models - The run's provider and models.
 * @returns The key, if the environment holds it.
 */
function apiKeyFor(models: EvalModels): string | undefined {
  const provider = models.provider ?? 'google';
  const apiKey = apiKeyOf(provider, process.env);
  if (apiKey === undefined)
    process.stdout.write(`${keyVariableOf(provider)} is not set: only cached responses play.\n`);
  return apiKey;
}

/**
 * Opens the judge the flags ask for: one fixed model, with a key of its own. Only `JUDGE_API_KEY`
 * turns it on: were the run's own key enough, a run on the judge's provider would be judged and a
 * run on another would not, and the two would not compare.
 *
 * @param flags - The flags.
 * @param draw - Which sample of the judge's answers to draw.
 * @returns The judge, or nothing when the flags turn it off or no key is set.
 */
async function openJudge(flags: Flags, draw = 1): Promise<LiveJudge | undefined> {
  if (flags['no-judge']) return undefined;
  const provider: EvalProvider = providerOf(flags['judge-provider'] ?? defaultJudge.provider);
  const model = flags['judge-model'] ?? defaultJudge.model;
  const apiKey = process.env.JUDGE_API_KEY || undefined;
  if (apiKey === undefined) {
    process.stdout.write('JUDGE_API_KEY is not set: no judge reads the rubrics.\n');
    return undefined;
  }
  const dir = join(here, '.cache', 'judge');
  return openLiveJudge({ provider, model, apiKey, dir, budget: judgeBudget, draw });
}

/**
 * What every trial of a run shares.
 *
 * @param flags - The flags.
 * @param judge - The judge, if one reads the rubrics.
 * @returns The setup.
 */
function setupOf(flags: Flags, judge: Judge | undefined): RunSetup {
  const models = modelsOf(flags);
  const trials = Number(flags.trials ?? 1);
  if (!Number.isInteger(trials) || trials < 1) throw new Error('--trials takes a whole number.');
  return {
    models,
    apiKey: apiKeyFor(models),
    cache: { dir: join(here, '.cache'), read: !flags['no-cache'], minIntervalMs: 4000 },
    search: flags.search ?? false,
    trials,
    sample: flags.sample ?? '',
    judge,
    pacing: { last: 0 },
    counts: { hits: 0, misses: 0 },
  };
}

/**
 * Prints a trial's status as it comes.
 *
 * @param evalCase - The case.
 * @param setup - The run's setup, for how many trials a case has.
 * @returns The printer.
 */
function printer(evalCase: EvalCase, setup: RunSetup): (trial: TrialResult) => void {
  return (trial) => {
    const which = setup.trials > 1 ? ` [${trial.trial}/${setup.trials}]` : '';
    process.stdout.write(`${evalCase.id}${which}: ${statusWord(trial.status)}\n`);
  };
}

/**
 * The cases a run takes, split into those the world can run and those it skips.
 *
 * @param flags - The flags.
 * @returns The plan.
 */
function planOf(flags: Flags) {
  const only = flags.only?.split(',').map((id) => id.trim()) ?? [];
  const catalogue = { defaults: defaultCases, named: namedCases, namedWord: parityWord };
  return planCases(selectCases(only, catalogue), flags.search ? ['search'] : []);
}

/**
 * What produced a run's numbers.
 *
 * @param setup - The run's setup.
 * @param judge - The judge, if one read the rubrics.
 * @returns The versions.
 */
function versionsOf(setup: RunSetup, judge: Judge | undefined): Report['versions'] {
  return {
    judge: judge?.label ?? null,
    judgePrompt: judgePromptVersion,
    data: new Date(evalsNow()).toISOString().slice(0, 10),
    sample: setup.sample,
  };
}

/**
 * Runs every case the world can run, one after the other, and prints each status as it comes.
 *
 * @param ready - The cases.
 * @param setup - The run's setup.
 * @returns Each case's results.
 */
async function runAll(ready: readonly EvalCase[], setup: RunSetup): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  for (const evalCase of ready)
    results.push(await runCase(evalCase, setup, printer(evalCase, setup)));
  return results;
}

/**
 * Runs every selected case, and prints the summary.
 *
 * @param flags - The flags.
 * @returns The report.
 */
async function evaluate(flags: Flags): Promise<Report> {
  const plan = planOf(flags);
  await checkSources(flags.search ?? false);
  const live = await openJudge(flags);
  const setup = setupOf(flags, live?.judge);
  const startedAt = new Date().toISOString();
  const results = await runAll(plan.ready, setup).finally(() => live?.close());
  for (const each of plan.skipped) process.stdout.write(`${skippedLine(each)}\n`);
  const known = knownUnstable(readBook(bookPath), setup.models);
  const report: Report = {
    version: 2,
    startedAt,
    models: setup.models,
    versions: versionsOf(setup, live?.judge),
    cache: setup.counts,
    judged: live?.judge.counts ?? { hits: 0, misses: 0 },
    results,
    ...(plan.skipped.length > 0 ? { skipped: plan.skipped } : {}),
    ...(known.length > 0 ? { knownUnstable: known } : {}),
  };
  // Trials are observations of the cases: the book keeps them for the runs to come.
  if (setup.trials > 1)
    writeBook(
      bookPath,
      observed(readBook(bookPath), setup.models, results, startedAt.slice(0, 10)),
    );
  process.stdout.write(`\n${summary(report)}\n`);
  return report;
}

/**
 * Compares two saved reports (`--compare`).
 *
 * @param positionals - The two files.
 * @returns The comparison.
 * @throws {Error} When a file is missing.
 */
function compared(positionals: readonly string[]): string {
  const [before, after] = positionals;
  if (!before || !after) throw new Error('Give two reports: --compare <a.json> <b.json>.');
  return comparison(readReport(before), readReport(after));
}

/**
 * Reads the rubrics of a saved report (`--judge`), twice with `--twice`.
 *
 * @param flags - The flags.
 * @param path - The report's file.
 * @returns What happened, in words.
 */
async function judgedSaved(flags: Flags, path: string): Promise<string> {
  const judges = [await openJudge(flags), ...(flags.twice ? [await openJudge(flags, 2)] : [])];
  return judgeSaved(path, judges, reportsDir);
}

/**
 * Runs a command that reads saved reports or fixtures and runs no selection of cases: compare,
 * rescore, calibrate, judge, or record.
 *
 * @param flags - The flags.
 * @param positionals - The files named after the flags.
 * @returns What it printed, or nothing when the flags name no such command.
 */
async function sideCommand(flags: Flags, positionals: string[]): Promise<string | undefined> {
  if (flags.compare) return compared(positionals);
  if (flags.rescore) return summary(rescore(readReport(flags.rescore)));
  if (flags.calibrate) return calibrate(positionals.map(readReport), join(here, 'judge'));
  if (flags.judge) return judgedSaved(flags, flags.judge);
  if (flags.record) return record(flags.record, setupOf(flags, undefined), join(here, 'fixtures'));
  return undefined;
}

/**
 * Runs what the flags ask.
 *
 * @returns The exit code.
 */
async function main(): Promise<number> {
  const { values: flags, positionals } = readFlags();
  if (flags.help) {
    process.stdout.write(usage);
    return 0;
  }
  const printed = await sideCommand(flags, positionals);
  if (printed !== undefined) {
    process.stdout.write(`${printed}\n`);
    return 0;
  }
  const report = await evaluate(flags);
  process.stdout.write(`\nReport: ${publish(report)}\n`);
  const allowed = flags['allow-failures'];
  return exitCodeOf(report, allowed === undefined ? undefined : Number(allowed));
}

try {
  process.exitCode = await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
