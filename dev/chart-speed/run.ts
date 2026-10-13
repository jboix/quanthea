/**
 * Measures how fast the app draws a dashboard's worth of time charts, in headless Chromium: 12
 * charts of 1,000, 5,000 and 20,000 points each, through the app's own chart component, on the
 * chart speed page of the development server. It prints the time to the first draw, what a
 * tooltip move and a resize cost, and how many charts are drawn at first, after scrolling and
 * when the page is printed. `bun run bench:charts`; `--kinds line,bar,scatter` adds bars
 * and points, `--runs 5` repeats more.
 *
 * It starts its own Vite server on port 5199 and stops it when it is done.
 */
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { type Browser, chromium, type Page } from 'playwright-core';

/** The port of the Vite server this script starts. */
const port = 5199;

/** The page. */
const pageUrl = `http://127.0.0.1:${port}/dev/chart-speed`;

/** The web app's folder. */
const webDir = join(import.meta.dir, '..', '..', 'apps', 'web');

/** How many points each chart draws, per round. */
const sizes = [1000, 5000, 20_000];

/** The window: a laptop's, as the screenshots use, and a tall one that shows every chart. */
const windows = { laptop: { width: 1440, height: 900 }, tall: { width: 1440, height: 1900 } };

/** The load times the page reports, as `speed-meter.ts` of the web app defines them. */
interface LoadTimes {
  readonly drawnMs: number;
  readonly settledMs: number;
  readonly longestFrameMs: number;
  readonly charts: number;
}

/** One measured load of the page. */
interface Sample extends LoadTimes {
  /** Mean milliseconds of a tooltip move on one chart. */
  readonly tooltipMs: number;
  /** Mean milliseconds of a resize of one chart. */
  readonly resizeMs: number;
  /** How many charts are drawn once the page was scrolled to its end. */
  readonly scrolled: number;
}

/** What one round measures. */
interface Round {
  readonly kind: string;
  readonly points: number;
  readonly window: keyof typeof windows;
}

/**
 * The middle value of some numbers.
 *
 * @param values - The numbers.
 * @returns The median.
 */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/**
 * The mean of some numbers.
 *
 * @param values - The numbers.
 * @returns The mean, or 0 for none.
 */
function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Starts the Vite server of the web app, and waits until it answers.
 *
 * @returns The server's process.
 * @throws {Error} When it does not answer within a minute.
 */
async function startVite() {
  const vite = join(webDir, 'node_modules', 'vite', 'bin', 'vite.js');
  const arguments_ = ['--port', String(port), '--strictPort', '--host', '127.0.0.1'];
  const server = Bun.spawn([process.execPath, vite, ...arguments_], {
    cwd: webDir,
    stdout: 'ignore',
    stderr: 'ignore',
  });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const answered = await fetch(pageUrl).then(
      (response) => response.ok,
      () => false,
    );
    if (answered) return server;
    await Bun.sleep(500);
  }
  server.kill();
  throw new Error(`Vite did not answer on port ${port}.`);
}

/**
 * Opens the page and waits until it has drawn and settled.
 *
 * @param page - The browser page.
 * @param round - What to draw.
 * @returns The load times.
 */
async function load(page: Page, round: Round): Promise<LoadTimes> {
  await page.setViewportSize(windows[round.window]);
  await page.goto(`${pageUrl}?points=${round.points}&kind=${round.kind}`);
  await page.waitForFunction('window.chartSpeed !== undefined', undefined, { timeout: 120_000 });
  return (await page.evaluate('window.chartSpeed.loaded')) as LoadTimes;
}

/**
 * Loads the page once and measures it: the load, then a tooltip move and a resize on the charts
 * drawn, then how many charts are drawn once the page was scrolled to its end.
 *
 * @param page - The browser page.
 * @param round - What to draw.
 * @returns The sample.
 */
async function measureOnce(page: Page, round: Round): Promise<Sample> {
  const times = await load(page, round);
  const tooltip = (await page.evaluate('window.chartSpeed.tooltip(40)')) as number[];
  const resize = (await page.evaluate('window.chartSpeed.resize()')) as number[];
  await page.mouse.wheel(0, 100_000);
  await page.waitForTimeout(1000);
  const scrolled = (await page.evaluate('window.chartSpeed.drawn()')) as number;
  return { ...times, tooltipMs: mean(tooltip), resizeMs: mean(resize), scrolled };
}

/**
 * Prints the page without scrolling it, and counts the charts drawn before and after.
 *
 * @param browser - The browser.
 * @returns What happened, as a line.
 */
async function printCheck(browser: Browser): Promise<string> {
  const page = await browser.newPage();
  const { charts } = await load(page, { kind: 'line', points: 5000, window: 'laptop' });
  await page.pdf();
  await page.waitForTimeout(500);
  const printed = (await page.evaluate('window.chartSpeed.drawn()')) as number;
  await page.close();
  return `Printing: ${charts} charts drawn in the laptop window, ${printed} once the page is printed.`;
}

/**
 * Measures one round several times and keeps the median of each number.
 *
 * @param browser - The browser.
 * @param round - What to draw.
 * @param runs - How many loads.
 * @returns The medians.
 */
async function measureRound(browser: Browser, round: Round, runs: number): Promise<Sample> {
  const samples: Sample[] = [];
  for (let run = 0; run < runs; run += 1) {
    const context = await browser.newContext({
      deviceScaleFactor: 2,
      reducedMotion: 'no-preference',
    });
    samples.push(await measureOnce(await context.newPage(), round));
    await context.close();
  }
  const middle = (pick: (sample: Sample) => number) => median(samples.map(pick));
  return {
    drawnMs: middle((sample) => sample.drawnMs),
    settledMs: middle((sample) => sample.settledMs),
    longestFrameMs: middle((sample) => sample.longestFrameMs),
    charts: middle((sample) => sample.charts),
    tooltipMs: middle((sample) => sample.tooltipMs),
    resizeMs: middle((sample) => sample.resizeMs),
    scrolled: middle((sample) => sample.scrolled),
  };
}

/**
 * One row of the table.
 *
 * @param round - What was drawn.
 * @param sample - What it took.
 * @returns The row, in Markdown.
 */
function row(round: Round, sample: Sample): string {
  const cells = [
    round.kind,
    round.points,
    round.window,
    sample.charts,
    sample.drawnMs.toFixed(0),
    sample.settledMs.toFixed(0),
    sample.longestFrameMs.toFixed(0),
    sample.tooltipMs.toFixed(2),
    sample.resizeMs.toFixed(2),
    sample.scrolled,
  ];
  return `| ${cells.join(' | ')} |`;
}

/** The head of the table. */
const head = [
  '| kind | points | window | charts drawn | drawn ms | settled ms | longest frame ms | tooltip move ms | resize ms | drawn after scrolling |',
  '| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
];

/**
 * The rounds: each kind at each size, in each window.
 *
 * @param kinds - The kinds of series to draw.
 * @returns The rounds, in order.
 */
function roundsOf(kinds: readonly string[]): Round[] {
  return kinds.flatMap((kind) =>
    sizes.flatMap((points) =>
      (['laptop', 'tall'] as const).map((window) => ({ kind, points, window })),
    ),
  );
}

/**
 * Measures every round and prints the table.
 *
 * @param kinds - The kinds of series to draw.
 * @param runs - How many loads per round.
 */
async function measureAll(kinds: readonly string[], runs: number): Promise<void> {
  const browser = await chromium.launch();
  try {
    // A first load lets Vite prepare its modules, so no round pays for it.
    await measureOnce(await browser.newPage(), { kind: 'line', points: 100, window: 'laptop' });
    process.stdout.write(`${head.join('\n')}\n`);
    for (const round of roundsOf(kinds)) {
      process.stdout.write(`${row(round, await measureRound(browser, round, runs))}\n`);
    }
    process.stdout.write(`\n${await printCheck(browser)}\n`);
  } finally {
    await browser.close();
  }
}

const { values } = parseArgs({
  options: { kinds: { type: 'string', default: 'line' }, runs: { type: 'string', default: '3' } },
});
const server = await startVite();
try {
  await measureAll(values.kinds.split(','), Number(values.runs) || 3);
} finally {
  process.kill(server.pid);
}
