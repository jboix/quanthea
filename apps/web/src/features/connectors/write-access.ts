/**
 * What a connection test says about writing, as the connector's page shows it: a warning when
 * the credentials can do more than read, a note when the source cannot say, and nothing else.
 * It never blocks anything: a connector whose credentials can write is saved and used as it is.
 */
import type { healthReportSchema } from '@quanthea/shared';
import type { z } from 'zod';

/** The result of a connection test. */
type HealthReport = z.output<typeof healthReportSchema>;

/** The headline of the warning. */
export const writeHeadline = 'These credentials can write. You may want to look at that.';

/** What the page shows about writing. */
export type WriteAccess =
  /** The test has not finished, failed, or found credentials that only read. */
  | { readonly state: 'quiet' }
  /** The credentials can do more than read. */
  | {
      readonly state: 'can-write';
      /** What they can do, as the test found it, one sentence each. */
      readonly canDo: readonly string[];
      /** How to make an account that only reads, to copy, when the kind gives it. */
      readonly setup: string | undefined;
    }
  /** The source did not say whether the credentials can write. */
  | {
      readonly state: 'unknown';
      /** How to make an account that only reads, to copy, when the kind gives it. */
      readonly setup: string | undefined;
    };

/**
 * What to show about writing for a connection test.
 *
 * @param report - The last report, if a test has finished.
 * @returns The warning with what was found, a note for a source that cannot say, or nothing.
 */
export function writeAccessOf(report: HealthReport | undefined): WriteAccess {
  if (!report?.ok || report.readOnly === true) return { state: 'quiet' };
  const setup = report.readOnlySetup?.trim() || undefined;
  if (report.readOnly === null) return { state: 'unknown', setup };
  return { state: 'can-write', canDo: report.canDo ?? [], setup };
}
