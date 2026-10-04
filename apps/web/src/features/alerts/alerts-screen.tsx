/**
 * The Alerts screen: every alert the role sees, searched by title and condition, filtered by state,
 * in sections Firing, Pending and OK, then drafts and deactivated alerts.
 */
import { hasRole } from '@quanthea/shared';
import { useCallback, useState } from 'react';
import { Link, useLoaderData, useSearchParams } from 'react-router';
import { Button, buttonClassName } from '../../ui/button.tsx';
import { SearchIcon } from '../../ui/icons.tsx';
import { Page } from '../../ui/page.tsx';
import { AlertRow } from './alert-row.tsx';
import { AlertSettingsDialog } from './alert-settings-dialog.tsx';
import styles from './alerts.module.css';
import type { AlertsData } from './data.ts';
import {
  type AlertFilter,
  type AlertSection,
  alertFilters,
  alertSections,
  filterCounts,
  filterFrom,
} from './grouping.ts';
import { useRole } from './use-role.ts';

/** The new-conversation screen with the alert mode chosen, through `?make=alert`. */
export const newAlertPath = '/threads/new?make=alert';

/** What each filter says. */
const filterLabels: Readonly<Record<AlertFilter, string>> = {
  all: 'All',
  firing: 'Firing',
  pending: 'Pending',
  ok: 'OK',
  muted: 'Muted',
  drafts: 'Drafts',
};

/** Props of {@link FilterChips}. */
interface FilterChipsProps {
  /** The filter on. */
  readonly filter: AlertFilter;
  /** How many alerts each filter shows. */
  readonly counts: Readonly<Record<AlertFilter, number>>;
  /** Whether drafts can be shown: editors only. */
  readonly drafts: boolean;
}

/**
 * The filters, each with its count; one is on at a time, kept in the URL.
 *
 * @param props - The filter on, the counts, and whether drafts show.
 * @returns The chips.
 */
function FilterChips({ filter, counts, drafts }: FilterChipsProps) {
  const [params, setParams] = useSearchParams();
  const choose = (next: AlertFilter) => {
    const search = new URLSearchParams(params);
    if (next === 'all') search.delete('show');
    else search.set('show', next);
    setParams(search, { replace: true, preventScrollReset: true });
  };
  const shown = alertFilters.filter((each) => drafts || each !== 'drafts');
  return (
    <fieldset className={styles.chips}>
      <legend className={styles.visuallyHidden}>Show</legend>
      {shown.map((each) => (
        <button
          key={each}
          type="button"
          className={styles.chip}
          aria-pressed={each === filter}
          onClick={() => choose(each)}
        >
          {filterLabels[each]} <span className={styles.chipCount}>{counts[each]}</span>
        </button>
      ))}
    </fieldset>
  );
}

/**
 * One section: its heading and its alerts.
 *
 * @param props - The section and the current time.
 * @param props.section - The section.
 * @param props.now - The current time.
 * @returns The section.
 */
function Section({ section, now }: { readonly section: AlertSection; readonly now: number }) {
  const headingId = `alerts-${section.id}`;
  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <h2 id={headingId} className={styles.sectionHeading} data-section={section.id}>
        {section.label}
      </h2>
      <ul className={styles.rows}>
        {section.alerts.map((alert) => (
          <AlertRow key={alert.id} alert={alert} now={now} />
        ))}
      </ul>
    </section>
  );
}

/**
 * What the list says when it shows nothing.
 *
 * @param props - Whether there are alerts at all.
 * @param props.any - `true` when some alert exists, so a filter or the search hides them.
 * @returns The note.
 */
function EmptyNote({ any }: { readonly any: boolean }) {
  const editor = hasRole(useRole(), 'editor');
  if (any) return <p className={styles.empty}>No alert matches. Try fewer words or show all.</p>;
  return (
    <p className={styles.empty}>
      {editor
        ? 'No alert yet. Start one with New alert: describe what to watch, and the agent writes it.'
        : 'No alert is active yet. Editors write alerts with the agent.'}
    </p>
  );
}

/** Where admins keep the channels alerts send to. */
const channelsPath = '/settings/notifications';

/**
 * What admins set for every alert: the Settings dialog, and a link to the notification channels.
 *
 * @returns The button, the link and the dialog.
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
      <AlertSettingsDialog open={open} onClose={close} />
    </>
  );
}

/**
 * The header's actions: for admins the settings and the channels, for editors New alert.
 *
 * @returns The actions, or nothing below editor.
 */
function HeaderActions() {
  const role = useRole();
  if (!hasRole(role, 'editor')) return null;
  return (
    <div className={styles.headerActions}>
      {role === 'admin' && <AdminActions />}
      <Link to={newAlertPath} className={buttonClassName('primary', 'large')}>
        New alert
      </Link>
    </div>
  );
}

/**
 * The Alerts screen.
 *
 * @returns The screen.
 */
export function AlertsScreen() {
  const { alerts } = useLoaderData() as AlertsData;
  const [params] = useSearchParams();
  const [search, setSearch] = useState('');
  const editor = hasRole(useRole(), 'editor');
  const filter = filterFrom(params.get('show'));
  const now = Date.now();
  const sections = alertSections(alerts, filter === 'drafts' && !editor ? 'all' : filter, search);
  return (
    <Page title="Alerts" actions={<HeaderActions />}>
      <search className={styles.search}>
        <span className={styles.searchIcon}>
          <SearchIcon />
        </span>
        <input
          type="search"
          aria-label="Search alerts"
          className={styles.searchInput}
          placeholder="Search alerts by title or condition"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </search>
      <FilterChips filter={filter} counts={filterCounts(alerts)} drafts={editor} />
      {sections.length === 0 && <EmptyNote any={alerts.length > 0} />}
      {sections.map((section) => (
        <Section key={section.id} section={section} now={now} />
      ))}
    </Page>
  );
}
