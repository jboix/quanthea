/**
 * `bun run evals`: asks the agent each question against the dev data and scores what it builds.
 * It needs the data sources (`bun run env:up`, and `bun run env:up:search` with `--search`) and the
 * provider's key, except for what the response cache already holds. It is never part of
 * `bun run verify`.
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { staleDataReason } from '@quanthea/dev/freshness.ts';
import { waitForFirstScrape } from '@quanthea/server/src/connectors/_shared/test/dev-sources.ts';
import { type AlertCase, alertCases, selectAlertCases } from './alert-cases.ts';
import { type AlertBench, driveAlert } from './alert-drive.ts';
import { type AnswerCase, answerCases, needsSearch, selectAnswerCases } from './answer-cases.ts';
import { type AnswerBench, driveAnswer, openBench } from './answer-drive.ts';
import { drive } from './drive.ts';
import { writeEvalmark } from './evalmark.ts';
import { type Need, type ParityCase, parityCases, parityWord } from './parity-cases.ts';
import { parityPlanOf, type Skipped, skippedLine } from './parity-score.ts';
import { apiKeyOf, keyVariableOf, providerOf, suggestedModels } from './providers.ts';
import { selectQuestions } from './questions.ts';
import { htmlReport, markdownReport } from './render.ts';
import {
  comparison,
  type EvalOutcome,
  type Report,
  readReport,
  scoreAll,
  summary,
  writeReport,
} from './report.ts';
import { type AnyReportCase, reportCases, selectReportCases } from './report-cases.ts';
import { driveReport, type ReportBench } from './report-drive.ts';
import { driveRunAnswer } from './run-answer-drive.ts';
import { type EvalModels, type EvalWorld, openWorld, waitForEvents } from './setup.ts';

/** What `--help` prints. */
const usage = `Asks the agent each question against the dev data, and scores what it builds. Then
asks the dashboard answering service the answer cases (a1 to a4) on the pinned checkout incident
dashboard, and with --search a5 on the player events, and scores its answers and explanations. Then drives the alert cases (al1 to al4)
through alert threads, and scores the alerts saved and their replay over the incident. Last, drives
the report cases (r1, r2) through a report thread, runs the report and checks its numbers against
the database, and asks about that run (r3, r4).

  bun run evals                         every question and case, on Gemini: gemini-3.5-flash-lite
                                        talks, gemini-3.8-flash builds
  bun run evals --provider anthropic    on Anthropic: claude-haiku-4-5 talks, claude-sonnet-5 builds
  bun run evals --only q3,q7            only these questions
  bun run evals --only a1,a2,a3,a4      only the answer cases
  bun run evals --only al1,al2,al3,al4  only the alert cases
  bun run evals --only r1,r2,r3,r4      only the report cases
  bun run evals --model gemini-3.8-flash
  bun run evals --build-model gemini-3.8-flash   another model for building and repairs
  bun run evals --search                with the dev OpenSearch as a third connector
  bun run evals --only parity --search  the parity questions (f01 to f33), one per family of
                                        panels on the player events; or --only f05,f11
  bun run evals --no-cache              ask the provider again, and keep its answers
  bun run evals --allow-failures 2      exit with an error when more than 2 questions fail
  bun run evals --rescore <report.json> score a report again, with no model call
  bun run evals --compare <a.json> <b.json>

It needs the data sources (bun run env:up, and bun run env:up:search with --search) and the
provider's key, GEMINI_API_KEY or ANTHROPIC_API_KEY, except for the responses the
cache in evals/.cache already holds. A run with --search lists one connector more in every
prompt, so it shares no cached response with a run without it. Reports go to evals/reports, as JSON and as an HTML page;
in GitHub Actions the summary also goes to the job's summary page. It exits with an error when
more questions fail than --allow-failures allows; without it, failing questions are reported,
never an error. The parity questions run only when --only names them, and need --search. One that
needs what the world lacks, such as an HTTP connector, is skipped and reported as skipped.
`;

/** What the world has of what a parity question may need: nothing yet. */
const worldHas: readonly Need[] = [];

const here = import.meta.dir;
const reportsDir = join(here, 'reports');

/**
 * Reads the flags.
 *
 * @returns The flags and the positional arguments.
 */
function readFlags() {
  const text = { type: 'string' } as const;
  const options = {
    only: text,
    provider: text,
    model: text,
    'build-model': text,
    search: { type: 'boolean' },
    'no-cache': { type: 'boolean' },
    'allow-failures': text,
    rescore: text,
    compare: { type: 'boolean' },
    help: { type: 'boolean' },
  } as const;
  return parseArgs({ args: process.argv.slice(2), options, allowPositionals: true });
}

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
 * The exit code for a report: an error when more questions fail than allowed. Without a limit,
 * failing questions are what the report shows, never an error: a model's answers vary.
 *
 * @param report - The report.
 * @param allowed - How many questions may fail, or `undefined` for no limit.
 * @returns The exit code.
 */
function exitCodeOf(report: Report, allowed: number | undefined): number {
  if (allowed === undefined) return 0;
  const failed = report.results.filter((result) => !result.score.pass).length;
  if (failed <= allowed) return 0;
  process.stderr.write(
    `${failed} ${failed === 1 ? 'question fails' : 'questions fail'}, more than the ${allowed} allowed.\n`,
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
 * Keeps an outcome and prints its verdict.
 *
 * @param outcomes - The outcomes so far.
 * @param outcome - The new one.
 */
function keep(outcomes: EvalOutcome[], outcome: EvalOutcome): void {
  outcomes.push(outcome);
  const [result] = scoreAll([outcome]);
  process.stdout.write(`${outcome.id}: ${result?.score.pass ? 'pass' : 'FAIL'}\n`);
}

/**
 * The answer cases a run asks: those `--only` keeps, without the ones about the dev OpenSearch
 * when the world has no search connector. It says which ones it leaves out.
 *
 * @param only - The ids to keep, or none for every case.
 * @param search - Whether the run adds the search connector.
 * @returns The cases.
 */
function answerPlan(only: readonly string[], search: boolean): readonly AnswerCase[] {
  const wanted = selectAnswerCases(only);
  if (search) return wanted;
  for (const left of wanted.filter(needsSearch))
    process.stdout.write(`${left.id}: skipped, it needs --search\n`);
  return wanted.filter((each) => !needsSearch(each));
}

/**
 * Runs the answer cases on the pinned checkout incident dashboard, one after the other.
 *
 * @param world - The world.
 * @param bench - Opens the pinned dashboard, once.
 * @param cases - The cases.
 * @param outcomes - The outcomes so far, which theirs join.
 * @returns Once every case has run.
 */
async function answerAll(
  world: EvalWorld,
  bench: () => Promise<AnswerBench>,
  cases: readonly AnswerCase[],
  outcomes: EvalOutcome[],
): Promise<void> {
  if (cases.length === 0) return;
  const opened = await bench();
  for (const answerCase of cases) keep(outcomes, await driveAnswer(world, opened, answerCase));
}

/**
 * Runs the alert cases in alert threads, one after the other, with the checkout incident
 * dashboard pinned for the case that starts from its panel.
 *
 * @param world - The world.
 * @param bench - Opens the pinned dashboard, once.
 * @param cases - The cases.
 * @param outcomes - The outcomes so far, which theirs join.
 * @returns Once every case has run.
 */
async function alertAll(
  world: EvalWorld,
  bench: () => Promise<AnswerBench>,
  cases: readonly AlertCase[],
  outcomes: EvalOutcome[],
): Promise<void> {
  if (cases.length === 0) return;
  const alertBench: AlertBench = { bench: await bench(), threads: new Map() };
  for (const alertCase of cases) keep(outcomes, await driveAlert(world, alertBench, alertCase));
}

/**
 * Runs the report cases, one after the other: report threads, then questions about their runs.
 *
 * @param world - The world.
 * @param bench - Opens the pinned dashboard, once.
 * @param cases - The cases.
 * @param outcomes - The outcomes so far, which theirs join.
 * @returns Once every case has run.
 */
async function reportAll(
  world: EvalWorld,
  bench: () => Promise<AnswerBench>,
  cases: readonly AnyReportCase[],
  outcomes: EvalOutcome[],
): Promise<void> {
  if (cases.length === 0) return;
  const reportBench: ReportBench = { bench: await bench(), threads: new Map(), runs: new Map() };
  for (const reportCase of cases) {
    const outcome =
      reportCase.mode === 'write'
        ? await driveReport(world, reportBench, reportCase)
        : await driveRunAnswer(world, reportBench, reportCase);
    keep(outcomes, outcome);
  }
}

/**
 * Asks the parity questions, one after the other, and says which ones were skipped.
 *
 * @param world - The world.
 * @param cases - The questions to ask.
 * @param skipped - The questions the world cannot answer yet.
 * @param outcomes - The outcomes so far, which theirs join.
 * @returns Once every question has run.
 */
async function parityAll(
  world: EvalWorld,
  cases: readonly ParityCase[],
  skipped: readonly Skipped[],
  outcomes: EvalOutcome[],
): Promise<void> {
  for (const parityCase of cases) keep(outcomes, await drive(world, parityCase));
  for (const each of skipped) process.stdout.write(`${skippedLine(each)}\n`);
}

/**
 * Opens the pinned checkout incident dashboard the first time it is asked for.
 *
 * @param world - The world.
 * @returns The opener.
 */
function benchOnce(world: EvalWorld): () => Promise<AnswerBench> {
  let opened: Promise<AnswerBench> | undefined;
  return () => {
    opened ??= openBench(world);
    return opened;
  };
}

/**
 * The run's provider and models: the flags, or else the models quanthea suggests for the provider.
 *
 * @param flags - The flags.
 * @returns The models.
 */
function modelsOf(flags: ReturnType<typeof readFlags>['values']): EvalModels {
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
 * The response cache of a run: read unless `--no-cache`, with live calls spaced apart.
 *
 * @param flags - The flags.
 * @returns The cache's place and behaviour.
 */
function cacheOf(flags: ReturnType<typeof readFlags>['values']) {
  return { dir: join(here, '.cache'), read: !flags['no-cache'], minIntervalMs: 4000 };
}

/**
 * Asks every selected question, then runs every selected answer case, alert case and report case,
 * then the parity questions `--only` names, one after the other, and prints each verdict as it
 * comes.
 *
 * @param flags - The flags.
 * @returns The report.
 */
async function evaluate(flags: ReturnType<typeof readFlags>['values']): Promise<Report> {
  const only = flags.only?.split(',').map((id) => id.trim()) ?? [];
  const cases = [...answerCases, ...alertCases, ...reportCases, ...parityCases];
  const selected = selectQuestions(only, [...cases.map((each) => each.id), parityWord]);
  const models = modelsOf(flags);
  const search = flags.search ?? false;
  const parity = parityPlanOf(only, worldHas, search);
  await checkSources(search);
  const world = await openWorld(models, apiKeyFor(models), cacheOf(flags), { search });
  const startedAt = new Date().toISOString();
  const outcomes: EvalOutcome[] = [];
  const bench = benchOnce(world);
  try {
    for (const question of selected) keep(outcomes, await drive(world, question));
    await answerAll(world, bench, answerPlan(only, search), outcomes);
    await alertAll(world, bench, selectAlertCases(only), outcomes);
    await reportAll(world, bench, selectReportCases(only), outcomes);
    await parityAll(world, parity.ready, parity.skipped, outcomes);
  } finally {
    await world.close();
  }
  const skipped = parity.skipped.length > 0 ? { skipped: parity.skipped } : {};
  const results = scoreAll(outcomes);
  const report = { startedAt, models, cache: world.counts, results, ...skipped };
  process.stdout.write(`\n${summary(report)}\n`);
  return report;
}

/**
 * A saved report, scored again against the questions as they are now.
 *
 * @param path - The report's file.
 * @returns The report with its new scores.
 */
function rescore(path: string): Report {
  const report = readReport(path);
  return { ...report, results: scoreAll(report.results.map((result) => result.outcome)) };
}

/**
 * Runs what the flags ask: compare, rescore, or evaluate.
 *
 * @returns The exit code.
 */
async function main(): Promise<number> {
  const { values: flags, positionals } = readFlags();
  if (flags.help) {
    process.stdout.write(usage);
    return 0;
  }
  if (flags.compare) {
    const [before, after] = positionals;
    if (!before || !after) throw new Error('Give two reports: --compare <a.json> <b.json>.');
    process.stdout.write(`${comparison(readReport(before), readReport(after))}\n`);
    return 0;
  }
  if (flags.rescore) {
    process.stdout.write(`${summary(rescore(flags.rescore))}\n`);
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
