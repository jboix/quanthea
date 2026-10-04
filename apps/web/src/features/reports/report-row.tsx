/**
 * One report in the list: its title with a dot when a run is new to the person, its schedule and
 * period, its last run's first headline number with its change, the history of that number, and
 * its next run. A draft shows dashed; a last run that failed says so in the danger colour.
 */
import type { ReportListItem } from '@quanthea/shared';
import { Link } from 'react-router';
import styles from './reports.module.css';
import { ValueHistory } from './value-history.tsx';
import { lastRunWords, nextRunWords, scheduleLine } from './words.ts';

/**
 * The last run's first headline number and its change, or what stands for it.
 *
 * @param props - The report.
 * @param props.report - The report.
 * @returns The value column.
 */
function LastValue({ report }: { readonly report: ReportListItem }) {
  if (report.activeVersion === null && report.lastRun === null)
    return <span className={styles.draftNote}>Draft v{report.latestVersion ?? 1}</span>;
  const last = lastRunWords(report.lastRun);
  if (last.kind === 'failed') return <span className={styles.failed}>{last.text}</span>;
  if (last.kind === 'none') return <span className={styles.aside}>{last.text}</span>;
  return (
    <span className={styles.value}>
      <span className={styles.caption}>{last.caption}</span>
      <span className={styles.number}>
        {last.text}
        {last.change && <span className={styles.change}> {last.change.text}</span>}
      </span>
    </span>
  );
}

/**
 * One row, a link to the report's latest run.
 *
 * @param props - The report.
 * @param props.report - The report.
 * @returns The list item.
 */
export function ReportRow({ report }: { readonly report: ReportListItem }) {
  const draft = report.activeVersion === null;
  const timeZone = report.schedule.timezone;
  return (
    <li>
      <Link to={`/reports/${report.id}`} className={styles.row} data-draft={draft}>
        <span className={styles.what}>
          <span className={styles.title}>
            {report.title}
            {report.unseen && (
              <span className={styles.unseen} role="img" aria-label="A run you have not opened" />
            )}
          </span>
          <span className={styles.aside}>{scheduleLine(report.schedule, report.period)}</span>
        </span>
        <LastValue report={report} />
        <ValueHistory history={report.history} />
        <span className={styles.next}>{nextRunWords(report.nextRunAt, timeZone, draft)}</span>
      </Link>
    </li>
  );
}
