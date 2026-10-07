/**
 * The report scheduler: an in-process job that ticks every few seconds, with no model. Each tick
 * makes the runs the schedule owes (after downtime, one run for the latest scheduled time, never a
 * backlog), then attempts them and the runs whose retry is due, within a cap per connector and a
 * cap in all. One failing run never stops the others.
 */
import { createLimiter, type LimiterCaps } from '../lib/limiter.ts';
import type { Logger } from '../lib/logger.ts';
import type { Reports, ScheduledRun } from '../reports/reports.ts';

/** What the scheduler needs. */
export interface ReportSchedulerDependencies {
  /** The reports. */
  readonly reports: Pick<Reports, 'startDue' | 'pending' | 'attempt'>;
  /** Reports failures. */
  readonly logger: Logger;
  /** The caps on runs attempted at once. */
  readonly caps?: LimiterCaps;
}

/** The scheduler. */
export interface ReportScheduler {
  /**
   * Makes the runs due, starts every attempt due, and waits for them.
   *
   * @returns When every attempt it started has finished.
   */
  tick(): Promise<void>;
}

/** The default caps: 4 runs at once, 2 per connector. */
const defaultCaps: LimiterCaps = { global: 4, perKey: 2 };

/** How often the job ticks, in milliseconds. */
const tickMs = 15_000;

/**
 * Lists the runs to attempt, logging a failure as none.
 *
 * @param dependencies - The reports and the logger.
 * @returns The runs made for the schedule, then the runs to try again.
 */
function runsToAttempt(dependencies: ReportSchedulerDependencies): ScheduledRun[] {
  try {
    const started = dependencies.reports.startDue();
    const known = new Set(started.map((run) => run.runId));
    const pending = dependencies.reports.pending().filter((run) => !known.has(run.runId));
    return [...started, ...pending];
  } catch (error) {
    dependencies.logger.error('the report runs could not be listed', { error: String(error) });
    return [];
  }
}

/**
 * Creates the scheduler.
 *
 * @param dependencies - The reports, the logger and the caps.
 * @returns The scheduler.
 */
export function createReportScheduler(dependencies: ReportSchedulerDependencies): ReportScheduler {
  const { logger, reports } = dependencies;
  const limiter = createLimiter(dependencies.caps ?? defaultCaps);
  const queued = new Set<string>();
  const attempt = async ({ runId, connector }: ScheduledRun) => {
    queued.add(runId);
    try {
      await limiter.run(connector, () => reports.attempt(runId));
    } catch (error) {
      logger.error('a report run failed', { runId, error: String(error) });
    } finally {
      queued.delete(runId);
    }
  };
  return {
    async tick() {
      const due = runsToAttempt(dependencies).filter((run) => !queued.has(run.runId));
      await Promise.all(due.map(attempt));
    },
  };
}

/**
 * Starts the scheduler: a tick now, then every 15 seconds.
 *
 * @param dependencies - The reports and the logger.
 * @returns Stops the job.
 */
export function startReportScheduler(dependencies: ReportSchedulerDependencies): () => void {
  const scheduler = createReportScheduler(dependencies);
  const tick = () => void scheduler.tick();
  tick();
  const timer = setInterval(tick, tickMs);
  return () => clearInterval(timer);
}
