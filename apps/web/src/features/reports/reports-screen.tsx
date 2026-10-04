/**
 * The Reports screen: every report the role sees, searched in the browser by title, schedule and
 * latest number. Editors start a new one in a conversation; admins open the report settings and
 * the notification channels.
 */
import { hasRole, type ReportListItem } from '@quanthea/shared';
import { useCallback, useState } from 'react';
import { Link, useLoaderData } from 'react-router';
import { Button, buttonClassName } from '../../ui/button.tsx';
import { SearchIcon } from '../../ui/icons.tsx';
import { Page } from '../../ui/page.tsx';
import type { ReportsData } from './data.ts';
import { ReportRow } from './report-row.tsx';
import { ReportSettingsDialog } from './report-settings-dialog.tsx';
import styles from './reports.module.css';
import { useRole } from './use-role.ts';
import { lastRunWords, scheduleLine } from './words.ts';

/** The new-conversation screen with the report mode chosen. */
export const newReportPath = '/threads/new?make=report';

/** Where admins keep the channels reports send to. */
const channelsPath = '/settings/notifications';

/**
 * The reports whose title, schedule or latest number hold every word typed.
 *
 * @param reports - The reports.
 * @param search - The words typed.
 * @returns The reports that match, in their order.
 */
export function searchReports(
  reports: readonly ReportListItem[],
  search: string,
): ReportListItem[] {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  return reports.filter((report) => {
    const last = lastRunWords(report.lastRun);
    const value = last.kind === 'value' ? `${last.caption} ${last.text}` : last.text;
    const text = `${report.title} ${scheduleLine(report.schedule, report.period)} ${value}`;
    return words.every((word) => text.toLowerCase().includes(word));
  });
}

/**
 * What admins set for every report: the Settings dialog, and a link to the channels.
 *
 * @returns The link, the button and the dialog.
 */
function AdminActions() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <Link to={channelsPath} className={buttonClassName('secondary', 'large')}>
        Notification channels
      </Link>
      <Button size="large" onClick={() => setOpen(true)}>
        Settings
      </Button>
      <ReportSettingsDialog open={open} onClose={close} />
    </>
  );
}

/**
 * The header's actions: for admins the settings and the channels, for editors New report.
 *
 * @returns The actions, or nothing below editor.
 */
function HeaderActions() {
  const role = useRole();
  if (!hasRole(role, 'editor')) return null;
  return (
    <div className={styles.headerActions}>
      {role === 'admin' && <AdminActions />}
      <Link to={newReportPath} className={buttonClassName('primary', 'large')}>
        New report
      </Link>
    </div>
  );
}

/**
 * What the list says when it shows nothing.
 *
 * @param props - Whether there are reports at all.
 * @param props.any - `true` when some report exists, so the search hides them.
 * @returns The note.
 */
function EmptyNote({ any }: { readonly any: boolean }) {
  const editor = hasRole(useRole(), 'editor');
  if (any) return <p className={styles.empty}>No report matches. Try fewer words.</p>;
  return (
    <p className={styles.empty}>
      {editor
        ? 'No report yet. Start one with New report: say what to send and when, and the agent writes it.'
        : 'No report is active yet. Editors write reports with the agent.'}
    </p>
  );
}

/**
 * The Reports screen.
 *
 * @returns The screen.
 */
export function ReportsScreen() {
  const { reports } = useLoaderData() as ReportsData;
  const [search, setSearch] = useState('');
  const shown = searchReports(reports, search);
  return (
    <Page title="Reports" actions={<HeaderActions />}>
      <search className={styles.search}>
        <span className={styles.searchIcon}>
          <SearchIcon />
        </span>
        <input
          type="search"
          aria-label="Search reports"
          className={styles.searchInput}
          placeholder="Search reports by title, schedule or number"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </search>
      {shown.length === 0 && <EmptyNote any={reports.length > 0} />}
      {shown.length > 0 && (
        <ul className={styles.rows} aria-label="Reports">
          {shown.map((report) => (
            <ReportRow key={report.id} report={report} />
          ))}
        </ul>
      )}
    </Page>
  );
}
