/**
 * The check of a report's run: its headline numbers against the orders the database holds for the
 * period it covered, counted on a path of its own. A count must lie between the paid orders and
 * every attempt, a revenue between their totals, and a failed share must be the database's.
 */
import type { Headline } from '@quanthea/shared';
import type { Truth } from '../core/case.ts';
import type { OrderTruth, ReportCaseOutcome, ReportCheck } from './report.ts';

/** How far a revenue may be outside the paid and all-orders totals, relative to them. */
const revenueSlack = 0.02;

/** How far a failed share may be from the database's, relative to it. */
const shareSlack = 0.02;

/**
 * What a headline counts, by its title: the failed orders, the revenue, or the orders.
 *
 * @param headline - The headline.
 * @returns The topic, or none.
 */
export function headlineTopic(headline: Headline): 'failed' | 'revenue' | 'orders' | undefined {
  if (/fail|error/i.test(headline.title)) return 'failed';
  if (/revenue|sales|turnover|amount|income/i.test(headline.title)) return 'revenue';
  if (/order|count/i.test(headline.title)) return 'orders';
  return undefined;
}

/**
 * Whether a number lies between two bounds, widened by a share of them.
 *
 * @param value - The number.
 * @param low - The lower bound.
 * @param high - The upper bound.
 * @param slack - The share each bound widens by.
 * @returns Whether it lies within.
 */
function within(value: number, low: number, high: number, slack: number): boolean {
  return value >= low * (1 - slack) && value <= high * (1 + slack);
}

/**
 * Whether a headline's number is a count the database allows: the paid orders at least, every
 * attempt at most.
 *
 * @param value - The number.
 * @param truth - The database's counts.
 * @returns Whether it fits.
 */
function ordersFit(value: number, truth: OrderTruth): boolean {
  return value >= truth.paid && value <= truth.all;
}

/**
 * Whether a revenue fits the database's, in cents or in francs: between the paid orders' total
 * and every attempt's, with some slack for refunds taken off or rounding.
 *
 * @param value - The number.
 * @param truth - The database's totals.
 * @returns Whether it fits.
 */
function revenueFits(value: number, truth: OrderTruth): boolean {
  return [1, 0.01].some((scale) =>
    within(value, truth.paidCents * scale, truth.allCents * scale, revenueSlack),
  );
}

/**
 * Whether a failed-orders number fits the database's: the count, or the share of every attempt
 * as a ratio or in percent.
 *
 * @param value - The number.
 * @param truth - The database's counts.
 * @returns Whether it fits.
 */
function failedFits(value: number, truth: OrderTruth): boolean {
  if (value === truth.failed) return true;
  const share = truth.all === 0 ? 0 : truth.failed / truth.all;
  return [share, share * 100].some((each) => within(value, each, each, shareSlack));
}

/** How each topic's number is checked, and what the database holds for it, in words. */
const checks = {
  orders: {
    fits: ordersFit,
    holds: (truth: OrderTruth) => `${truth.paid} to ${truth.all} orders`,
  },
  revenue: {
    fits: revenueFits,
    holds: (truth: OrderTruth) => `${truth.paidCents} to ${truth.allCents} cents`,
  },
  failed: {
    fits: failedFits,
    holds: (truth: OrderTruth) => `${truth.failed} failed of ${truth.all}`,
  },
} as const;

/**
 * What is wrong with one headline's number against the database.
 *
 * @param headline - The headline.
 * @param truth - The database's counts.
 * @returns The reasons.
 */
function headlineFaults(headline: Headline, truth: OrderTruth): string[] {
  const topic = headlineTopic(headline);
  if (topic === undefined) return [];
  const check = checks[topic];
  if (headline.value !== null && check.fits(headline.value, truth)) return [];
  return [
    `the headline “${headline.title}” is ${headline.value}, the database holds ${check.holds(truth)}`,
  ];
}

/**
 * The orders of the period a run covered, counted on the dev Postgres directly.
 *
 * @param count - Counts the orders of a period.
 * @returns The truth; nothing for a run that did not succeed.
 */
export function ordersOfRun(
  count: (period: { from: number; to: number }) => Promise<OrderTruth>,
): Truth<OrderTruth | undefined> {
  const compute = async (_now: number, evidence: unknown) => {
    const { run } = evidence as ReportCaseOutcome;
    return run?.status === 'ok' ? count(run.period) : undefined;
  };
  return { key: 'orders', compute };
}

/**
 * What is wrong with the run: it must succeed, and its headlines must count the orders and the
 * revenue as the database does.
 *
 * @param outcome - What the case gave.
 * @param truth - The database's counts over the run's period, if they were counted.
 * @returns The faults.
 */
function runFaults(outcome: ReportCaseOutcome, truth: OrderTruth | undefined): string[] {
  const { run } = outcome;
  if (!run) return ['the saved version was not run'];
  if (run.status !== 'ok') return [`the run failed: ${run.error ?? run.status}`];
  if (!truth) return ['the orders of the period were not counted'];
  const topics = new Set(run.headlines.map(headlineTopic));
  const missing = (['orders', 'revenue'] as const).filter((each) => !topics.has(each));
  const reasons = missing.map((each) => `no headline number for the ${each}`);
  return [...reasons, ...run.headlines.flatMap((each) => headlineFaults(each, truth))];
}

/**
 * A run of the saved version succeeds, and its headline numbers are the orders and the revenue
 * the database holds for the run's period.
 *
 * @param truth - The database's counts.
 * @returns The check.
 */
export function runMatchesDatabase(truth: Truth<OrderTruth | undefined>): ReportCheck {
  const faults: ReportCheck['faults'] = (outcome, context) =>
    outcome.spec
      ? runFaults(outcome, (context.truth[truth.key] ?? outcome.truth) as OrderTruth | undefined)
      : [];
  return { id: 'run-matches-database', kind: 'result', truths: [truth], faults };
}
