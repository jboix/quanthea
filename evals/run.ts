/**
 * `bun run evals`: asks the agent each question against the dev data and scores what it builds.
 * It needs the data sources (`bun run env:up`) and GEMINI_API_KEY, except for what the response
 * cache already holds. It is never part of `bun run verify`.
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { staleDataReason } from '@quanthea/dev/freshness.ts';
import { waitForFirstScrape } from '@quanthea/server/src/connectors/_shared/test/dev-sources.ts';
import { drive } from './drive.ts';
import { selectQuestions } from './questions.ts';
import { htmlReport, markdownReport } from './render.ts';
import { comparison, type Report, readReport, scoreAll, summary, writeReport } from './report.ts';
import type { Outcome } from './score.ts';
import { type EvalModels, openWorld } from './setup.ts';

/** What `--help` prints. */
const usage = `Asks the agent each question against the dev data, and scores what it builds.

  bun run evals                         every question, on gemini-3.5-flash-lite
  bun run evals --only q3,q7            only these questions
  bun run evals --model gemini-3.8-flash
  bun run evals --build-model gemini-3.8-flash   another model for building and repairs
  bun run evals --no-cache              ask the provider again, and keep its answers
  bun run evals --allow-failures 2      exit with success when at most 2 questions fail
  bun run evals --rescore <report.json> score a report again, with no model call
  bun run evals --compare <a.json> <b.json>

It needs the data sources (bun run env:up) and GEMINI_API_KEY, except for the responses the
cache in evals/.cache already holds. Reports go to evals/reports, as JSON and as an HTML page;
in GitHub Actions the summary also goes to the job's summary page. It exits with an error when
more questions fail than --allow-failures allows, 0 by default.
`;

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
    model: { type: 'string', default: 'gemini-3.5-flash-lite' },
    'build-model': text,
    'no-cache': { type: 'boolean' },
    'allow-failures': { type: 'string', default: '0' },
    rescore: text,
    compare: { type: 'boolean' },
    help: { type: 'boolean' },
  } as const;
  return parseArgs({ args: process.argv.slice(2), options, allowPositionals: true });
}

/**
 * Keeps a report: JSON to score again, an HTML page to read, and in GitHub Actions the job's
 * summary page.
 *
 * @param report - The report.
 * @returns The HTML page's path.
 */
function publish(report: Report): string {
  const json = writeReport(reportsDir, report);
  const html = json.replace(/\.json$/, '.html');
  writeFileSync(html, htmlReport(report));
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) appendFileSync(summaryFile, markdownReport(report));
  return html;
}

/**
 * The exit code for a report: an error when more questions fail than allowed.
 *
 * @param report - The report.
 * @param allowed - How many questions may fail.
 * @returns The exit code.
 */
function exitCodeOf(report: Report, allowed: number): number {
  const failed = report.results.filter((result) => !result.score.pass).length;
  if (failed <= allowed) return 0;
  process.stderr.write(
    `${failed} ${failed === 1 ? 'question fails' : 'questions fail'}, more than the ${allowed} allowed.\n`,
  );
  return 1;
}

/**
 * Asks every selected question, one after the other, and prints each verdict as it comes.
 *
 * @param flags - The flags.
 * @returns The report.
 */
async function evaluate(flags: ReturnType<typeof readFlags>['values']): Promise<Report> {
  const selected = selectQuestions(flags.only?.split(',').map((id) => id.trim()) ?? []);
  const models: EvalModels = { model: flags.model, build: flags['build-model'] };
  await waitForFirstScrape().catch(() => {
    throw new Error('The dev data sources do not answer. Start them with bun run env:up.');
  });
  const stale = await staleDataReason(new Date());
  if (stale) throw new Error(stale);
  const cache = { dir: join(here, '.cache'), read: !flags['no-cache'], minIntervalMs: 4000 };
  const world = await openWorld(models, process.env.GEMINI_API_KEY || undefined, cache);
  const startedAt = new Date().toISOString();
  const outcomes: Outcome[] = [];
  try {
    for (const question of selected) {
      const outcome = await drive(world, question);
      outcomes.push(outcome);
      const [result] = scoreAll([outcome]);
      process.stdout.write(`${question.id}: ${result?.score.pass ? 'pass' : 'FAIL'}\n`);
    }
  } finally {
    await world.close();
  }
  const report = { startedAt, models, cache: world.counts, results: scoreAll(outcomes) };
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
  return exitCodeOf(report, Number(flags['allow-failures']));
}

try {
  process.exitCode = await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
