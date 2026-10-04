/**
 * Scores what a report conversation saved against what a good report holds: the schedule, the
 * period, the comparison, the headline panels, the connector, the preview, the channels, and the
 * numbers of a run against the database's own. Pure, so a saved report can be scored again with no
 * model call (`--rescore`).
 */
import type { Headline, ReportSpec, TurnUsage } from '@quanthea/shared';
import type { ReportExpectation, ScheduleExpectation } from './report-cases.ts';
import type { Score } from './score.ts';

/** The orders of a run's period, counted on the dev Postgres directly. */
export interface OrderTruth {
  /** The paid orders. */
  readonly paid: number;
  /** Every order attempt: paid, refunded and failed. */
  readonly all: number;
  /** The failed ones. */
  readonly failed: number;
  /** The paid orders' totals, in cents. */
  readonly paidCents: number;
  /** Every order attempt's total, in cents. */
  readonly allCents: number;
}

/** A run of the saved version, as the report keeps it: no panel results. */
export interface RunSummary {
  /** `ok`, `failed` or `running`. */
  readonly status: string;
  /** Why it failed, when it did. */
  readonly error: string | null;
  /** The period it covered. */
  readonly period: { readonly from: number; readonly to: number; readonly label: string };
  /** Its headline numbers. */
  readonly headlines: readonly Headline[];
}

/** What happened when the agent wrote a report for a case. */
export interface ReportCaseOutcome {
  /** Marks a report case's outcome apart from the others. */
  readonly kind: 'report';
  /** The case's id. */
  readonly id: string;
  /** The spec of the report's latest version, when it has one. */
  readonly spec?: ReportSpec;
  /** How many versions the case saved. */
  readonly versions: number;
  /** The ids of the channels the agent was offered. */
  readonly channelIds: readonly string[];
  /** Why the preview of the latest version failed, `null` when every query ran. */
  readonly previewFailure?: string | null;
  /** A run of the latest version, made now, when the case checks one. */
  readonly run?: RunSummary;
  /** The orders of the run's period, from the database. */
  readonly truth?: OrderTruth;
  /** The model's tool calls, by tool name. */
  readonly toolCalls: Readonly<Record<string, number>>;
  /** What the agent said in the case's turns. */
  readonly said: string;
  /** What the agent asked the person. */
  readonly asked: readonly string[];
  /** How many writes failed their checks. */
  readonly repairs: number;
  /** How many runs it took. */
  readonly turns: number;
  /** The tokens spent, by model. */
  readonly usage: TurnUsage;
  /** How long it took, in milliseconds. */
  readonly durationMs: number;
  /** Why a run failed, when one did. */
  readonly error?: string;
}

/** How far a revenue may be outside the paid and all-orders totals, relative to them. */
const revenueSlack = 0.02;

/** How far a failed share may be from the database's, relative to it. */
const shareSlack = 0.02;

/**
 * What is wrong with the schedule.
 *
 * @param schedule - The spec's schedule.
 * @param wanted - The schedule a good report runs on.
 * @returns The reasons.
 */
function scheduleFaults(schedule: ReportSpec['schedule'], wanted: ScheduleExpectation): string[] {
  const reasons: string[] = [];
  if (schedule.every !== wanted.every)
    reasons.push(`it runs every ${schedule.every}, expected every ${wanted.every}`);
  const weekday = schedule.every === 'week' ? schedule.weekday : undefined;
  if (wanted.weekday !== undefined && weekday !== wanted.weekday)
    reasons.push(`it runs on ${weekday ?? 'no weekday'}, expected ${wanted.weekday}`);
  if (schedule.at !== wanted.at) reasons.push(`it runs at ${schedule.at}, expected ${wanted.at}`);
  if (schedule.timezone !== wanted.timezone)
    reasons.push(`its clock is ${schedule.timezone}, expected ${wanted.timezone}`);
  return reasons;
}

/**
 * What is wrong with the schedule, the period and the comparison.
 *
 * @param spec - The spec.
 * @param expect - What a good report holds.
 * @returns The reasons.
 */
function timingFaults(spec: ReportSpec, expect: ReportExpectation): string[] {
  const reasons = scheduleFaults(spec.schedule, expect.schedule);
  if (spec.period !== expect.period)
    reasons.push(`it covers ${spec.period}, expected ${expect.period}`);
  if (spec.compare !== expect.compare)
    reasons.push(`it compares with ${spec.compare}, expected ${expect.compare}`);
  return reasons;
}

/**
 * The summary panels of a spec, each as its title and queries written out.
 *
 * @param spec - The spec.
 * @returns The texts, in the summary's order.
 */
function summaryTexts(spec: ReportSpec): string[] {
  return spec.summaryPanels.flatMap((id) => {
    const panel = spec.panels.find((each) => each.id === id);
    return panel ? [`${panel.title}\n${JSON.stringify(panel.queries)}`] : [];
  });
}

/**
 * What is wrong with the panels: the headline topics, the connector, the channels.
 *
 * @param spec - The spec.
 * @param expect - What a good report holds.
 * @param channelIds - The channels the agent was offered.
 * @returns The reasons.
 */
function contentFaults(
  spec: ReportSpec,
  expect: ReportExpectation,
  channelIds: readonly string[],
): string[] {
  const texts = summaryTexts(spec);
  const reasons = expect.summaryTopics
    .filter((topic) => !texts.some((text) => topic.test(text)))
    .map((topic) => `no headline panel shows ${topic.source.split('|').join(' or ')}`);
  const elsewhere = spec.panels.flatMap((panel) =>
    panel.queries.filter((query) => query.connector !== expect.connector).map(() => panel.title),
  );
  if (elsewhere.length > 0)
    reasons.push(
      `panels query another connector than ${expect.connector}: ${elsewhere.join(', ')}`,
    );
  const strangers = spec.delivery.channels.filter((id) => !channelIds.includes(id));
  if (strangers.length > 0)
    reasons.push(`the report names unknown channels: ${strangers.join(', ')}`);
  return reasons;
}

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
 * What is wrong with the run: it must succeed, and its headlines must count the orders and the
 * revenue as the database does.
 *
 * @param outcome - What the case gave.
 * @returns The reasons.
 */
function runFaults(outcome: ReportCaseOutcome): string[] {
  const { run, truth } = outcome;
  if (!run) return ['the saved version was not run'];
  if (run.status !== 'ok') return [`the run failed: ${run.error ?? run.status}`];
  if (!truth) return ['the orders of the period were not counted'];
  const topics = new Set(run.headlines.map(headlineTopic));
  const missing = (['orders', 'revenue'] as const).filter((topic) => !topics.has(topic));
  const reasons = missing.map((topic) => `no headline number for the ${topic}`);
  return [...reasons, ...run.headlines.flatMap((headline) => headlineFaults(headline, truth))];
}

/**
 * Scores a report case's outcome.
 *
 * @param outcome - What the case gave.
 * @param expect - What a good report holds.
 * @returns Pass or not, and why not.
 */
export function scoreReport(outcome: ReportCaseOutcome, expect: ReportExpectation): Score {
  if (outcome.error !== undefined)
    return { pass: false, reasons: [`the run failed: ${outcome.error}`] };
  const { spec } = outcome;
  if (!spec) return { pass: false, reasons: ['no report version was saved'] };
  const preview =
    outcome.previewFailure === null
      ? []
      : [`the preview failed: ${outcome.previewFailure ?? 'it did not run'}`];
  const reasons = [
    ...timingFaults(spec, expect),
    ...contentFaults(spec, expect, outcome.channelIds),
    ...preview,
    ...(expect.newVersion && outcome.versions === 0 ? ['no new version was saved'] : []),
    ...(expect.checkRun ? runFaults(outcome) : []),
  ];
  return { pass: reasons.length === 0, reasons };
}

/**
 * Whether an outcome is a report case's.
 *
 * @param outcome - The outcome.
 * @returns Whether it is a report case's.
 */
export function isReport<Other extends object>(
  outcome: ReportCaseOutcome | Other,
): outcome is ReportCaseOutcome {
  return 'kind' in outcome && outcome.kind === 'report';
}
