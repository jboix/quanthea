/**
 * The purge job: once at startup and then every hour, it deletes for good the threads and the
 * conversations that have waited in the bin longer than the retention setting allows, the snapshots whose time is up, the
 * sessions that have ended, the old sends of the notification channels' log, the alerts'
 * changes of state older than 90 days, and the report runs past the report settings' retention.
 */

import type { Alerts } from '../alerts/alerts.ts';
import type { Sessions } from '../auth/sessions.ts';
import type { ConversationBin } from '../dashboards/conversation-bin.ts';
import type { Snapshots } from '../dashboards/snapshots.ts';
import type { Logger } from '../lib/logger.ts';
import type { Notifications } from '../notifications/notifications.ts';
import type { Reports } from '../reports/reports.ts';
import type { RetentionSettingsService } from '../settings/retention-settings.ts';
import type { ThreadBin } from '../threads/bin.ts';

/** What the purge job needs. */
export interface PurgeJobDependencies {
  /** The bin of threads. */
  readonly bin: Pick<ThreadBin, 'purgeAll'>;
  /** The bin of conversations about dashboards. */
  readonly conversationBin?: Pick<ConversationBin, 'purgeAll'> | undefined;
  /** The retention settings. */
  readonly retention: Pick<RetentionSettingsService, 'get'>;
  /** The snapshots, whose expired ones the job deletes. */
  readonly snapshots?: Pick<Snapshots, 'purgeExpired'> | undefined;
  /** The alerts, whose changes of state older than 90 days the job deletes. */
  readonly alerts?: Pick<Alerts, 'purgeEvents'> | undefined;
  /** The sessions, whose ended rows the job deletes. */
  readonly sessions?: Pick<Sessions, 'purgeEnded'> | undefined;
  /** The notification channels, whose log keeps only recent sends. */
  readonly notifications?: Pick<Notifications, 'purgeSends'> | undefined;
  /** The reports, whose runs past the retention setting the job deletes. */
  readonly reports?: Pick<Reports, 'purgeRuns'> | undefined;
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
 * Deletes for good the threads and the conversations binned longer ago than the retention setting
 * allows.
 *
 * @param dependencies - The bins, the retention settings, the logger and the clock.
 * @returns How many threads and conversations it deleted; none when the bin keeps them until
 *   someone deletes them.
 */
export function purgeExpired(dependencies: PurgeJobDependencies): number {
  const { binDays } = dependencies.retention.get();
  if (binDays === null) return 0;
  const before = (dependencies.now ?? Date.now)() - binDays * dayMs + 1;
  const purged = dependencies.bin.purgeAll('retention', before);
  if (purged > 0) dependencies.logger.info('purged binned threads', { purged, binDays });
  const conversations = dependencies.conversationBin?.purgeAll('retention', before) ?? 0;
  if (conversations > 0)
    dependencies.logger.info('purged binned conversations', { purged: conversations, binDays });
  return purged + conversations;
}

/**
 * Deletes the snapshots whose time is up. Opening one is refused from the moment it expires; this
 * frees the space.
 *
 * @param dependencies - The snapshots and the logger.
 * @returns How many snapshots it deleted.
 */
export function purgeSnapshots(dependencies: PurgeJobDependencies): number {
  const purged = dependencies.snapshots?.purgeExpired() ?? 0;
  if (purged > 0) dependencies.logger.info('purged expired snapshots', { purged });
  return purged;
}

/**
 * Deletes the report runs older than the report settings keep them. Reports and their versions
 * stay, and the usage ledger is untouched: runs use no model.
 *
 * @param dependencies - The reports and the logger.
 * @returns How many runs it deleted.
 */
export function purgeReportRuns(dependencies: PurgeJobDependencies): number {
  const purged = dependencies.reports?.purgeRuns() ?? 0;
  if (purged > 0) dependencies.logger.info('purged old report runs', { purged });
  return purged;
}

/**
 * Starts the purge job: now, then every hour. A failed run is logged and the next one tries again.
 *
 * @param dependencies - The bin, the retention settings, the snapshots, the sessions, the
 *   notifications, the alerts, the reports, the logger and the clock.
 * @returns Stops the job.
 */
export function startPurgeJob(dependencies: PurgeJobDependencies): () => void {
  const run = () => {
    try {
      purgeExpired(dependencies);
      purgeSnapshots(dependencies);
      dependencies.sessions?.purgeEnded();
      dependencies.notifications?.purgeSends();
      dependencies.alerts?.purgeEvents();
      purgeReportRuns(dependencies);
    } catch (error) {
      dependencies.logger.error('the purge job failed', { error: String(error) });
    }
  };
  run();
  const timer = setInterval(run, hourMs);
  return () => clearInterval(timer);
}
