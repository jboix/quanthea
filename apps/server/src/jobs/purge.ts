/**
 * The purge job: once at startup and then every hour, it deletes for good the threads that have
 * waited in the bin longer than the retention setting allows.
 */
import type { Logger } from '../lib/logger.ts';
import type { RetentionSettingsService } from '../settings/retention-settings.ts';
import type { ThreadBin } from '../threads/bin.ts';

/** What the purge job needs. */
export interface PurgeJobDependencies {
  /** The bin of threads. */
  readonly bin: Pick<ThreadBin, 'purgeAll'>;
  /** The retention settings. */
  readonly retention: Pick<RetentionSettingsService, 'get'>;
  /** Where it reports what it purged, and failures. */
  readonly logger: Logger;
  /** The clock; `Date.now` by default. */
  readonly now?: () => number;
}

/** A day, in milliseconds. */
const dayMs = 86_400_000;

/** How often the job runs, in milliseconds. */
const hourMs = 3_600_000;

/**
 * Deletes for good the threads binned longer ago than the retention setting allows.
 *
 * @param dependencies - The bin, the retention settings, the logger and the clock.
 * @returns How many threads it deleted; none when the bin keeps threads until someone deletes them.
 */
export function purgeExpired(dependencies: PurgeJobDependencies): number {
  const { binDays } = dependencies.retention.get();
  if (binDays === null) return 0;
  const now = (dependencies.now ?? Date.now)();
  const purged = dependencies.bin.purgeAll('retention', now - binDays * dayMs + 1);
  if (purged > 0) dependencies.logger.info('purged binned threads', { purged, binDays });
  return purged;
}

/**
 * Starts the purge job: now, then every hour. A failed run is logged and the next one tries again.
 *
 * @param dependencies - The bin, the retention settings, the logger and the clock.
 * @returns Stops the job.
 */
export function startPurgeJob(dependencies: PurgeJobDependencies): () => void {
  const run = () => {
    try {
      purgeExpired(dependencies);
    } catch (error) {
      dependencies.logger.error('the purge job failed', { error: String(error) });
    }
  };
  run();
  const timer = setInterval(run, hourMs);
  return () => clearInterval(timer);
}
