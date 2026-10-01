/**
 * The usage ledger: every model step's tokens and list-price cost, and every view of a pinned
 * dashboard, kept apart from threads so deleting one keeps its history. The cost is priced when
 * the step happens, so later price changes do not rewrite the past.
 */
import { costOf, pricesCheckedOn, type TokenUsage, type UsageReport } from '@quanthea/shared';
import type { UsageEventRow, UsageRepository } from '../db/usage-repository.ts';
import { newId } from '../lib/ids.ts';

/** A model step to record. */
export interface ModelStep {
  /** The thread; `null` for a call outside one, such as tagging a dashboard at pin time. */
  readonly threadId: string | null;
  /** The provider, such as `mistral`. */
  readonly provider: string;
  /** The model id. */
  readonly model: string;
  /** The job, such as `plan` or `build`. */
  readonly job: string;
  /** The step's tokens. */
  readonly tokens: TokenUsage;
}

/** The usage report as the ledger has it; the API adds the names of the users it names. */
export type LedgerReport = Omit<UsageReport, 'people'>;

/** This month's usage, for the model settings screen. */
export interface MonthUsage {
  /** Tokens, input and output. */
  readonly tokens: number;
  /** Threads that spent tokens. */
  readonly threads: number;
  /** Views of pinned dashboards, which spend none. */
  readonly pinnedViews: number;
  /** The list-price cost. */
  readonly dollars: number;
}

/** The usage service. */
export interface Usage {
  /**
   * Records a model step.
   *
   * @param step - The step.
   */
  recordStep(step: ModelStep): void;
  /**
   * Records a view of a pinned dashboard.
   *
   * @param dashboardId - The dashboard.
   */
  recordPinnedView(dashboardId: string): void;
  /**
   * The report of the last days, by hour.
   *
   * @param days - How many days back.
   * @returns The report.
   */
  report(days: number): LedgerReport;
  /**
   * This month's totals.
   *
   * @returns The totals.
   */
  month(): MonthUsage;
}

/** What the usage service needs. */
export interface UsageDependencies {
  /** The ledger. */
  readonly repository: UsageRepository;
  /** The clock; `Date.now` by default. */
  readonly now?: () => number;
}

/** One day, in milliseconds. */
const dayMs = 86_400_000;

/**
 * The list-price cost of a step, in millionths of a dollar.
 *
 * @param step - The step.
 * @returns The cost, or `null` when the model has no price.
 */
function costMicros(step: ModelStep): number | null {
  const { dollars, unpriced } = costOf({ [step.model]: step.tokens });
  return unpriced.length > 0 ? null : Math.round(dollars * 1e6);
}

/**
 * The report of a time range.
 *
 * @param repository - The ledger.
 * @param from - The start.
 * @param to - The end.
 * @returns The report.
 */
function reportOf(repository: UsageRepository, from: number, to: number): LedgerReport {
  const buckets = repository.buckets(from, to).map(({ costMicros: micros, ...bucket }) => ({
    ...bucket,
    dollars: micros / 1e6,
  }));
  return { from, to, pricesCheckedOn, buckets };
}

/**
 * The totals of a report.
 *
 * @param report - The report.
 * @param threads - How many threads spent tokens.
 * @returns The totals.
 */
function totalsOf(report: LedgerReport, threads: number): MonthUsage {
  let tokens = 0;
  let pinnedViews = 0;
  let dollars = 0;
  for (const bucket of report.buckets) {
    tokens += bucket.input + bucket.cachedInput + bucket.cacheWrite + bucket.output;
    if (bucket.kind === 'pinned_view') pinnedViews += bucket.events;
    dollars += bucket.dollars;
  }
  return { tokens, threads, pinnedViews, dollars };
}

/**
 * The start of the current month, UTC.
 *
 * @param now - The current instant.
 * @returns Epoch milliseconds.
 */
function monthStart(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

/**
 * The ledger event of a model step.
 *
 * @param step - The step.
 * @param at - When.
 * @returns The event.
 */
function stepEvent(step: ModelStep, at: number): UsageEventRow {
  const { threadId, provider, model, job, tokens } = step;
  const cost = costMicros(step);
  return {
    id: newId(),
    at,
    kind: 'model',
    dashboardId: null,
    costMicros: cost,
    ...tokens,
    threadId,
    provider,
    model,
    job,
  };
}

/**
 * The ledger event of a pinned dashboard's view.
 *
 * @param dashboardId - The dashboard.
 * @param at - When.
 * @returns The event.
 */
function viewEvent(dashboardId: string, at: number): UsageEventRow {
  const none = { threadId: null, provider: null, model: null, job: null, costMicros: null };
  const tokens = { input: 0, cachedInput: 0, cacheWrite: 0, output: 0 };
  return { id: newId(), at, kind: 'pinned_view', dashboardId, ...none, ...tokens };
}

/**
 * Creates the usage service.
 *
 * @param dependencies - The ledger and the clock.
 * @returns The service.
 */
export function createUsage(dependencies: UsageDependencies): Usage {
  const { repository } = dependencies;
  const now = dependencies.now ?? Date.now;
  return {
    recordStep: (step) => repository.record(stepEvent(step, now())),
    recordPinnedView: (dashboardId) => repository.record(viewEvent(dashboardId, now())),
    report: (days) => reportOf(repository, now() - days * dayMs, now() + 1),
    month: () => {
      const since = monthStart(now());
      return totalsOf(reportOf(repository, since, now() + 1), repository.threadsSince(since));
    },
  };
}
