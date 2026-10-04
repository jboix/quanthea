import type { DashboardSpec } from '@quanthea/shared';
import { Link, type SubmitTarget, useFetcher } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { HistoryIcon, InfoIcon } from '../../ui/icons.tsx';
import { Pill } from '../../ui/pill.tsx';
import { Popover } from '../../ui/popover.tsx';
import styles from './dashboard.module.css';
import type { DashboardData, DashboardIntent, Loaded } from './data.ts';

/**
 * How each connector is used: by how many panels, and whether for markers.
 *
 * @param spec - The spec.
 * @returns Pairs of connector name and usage, such as `5 panels` or `1 panel + markers`.
 */
function sourcesOf(spec: DashboardSpec): [string, string][] {
  const panels = new Map<string, number>();
  for (const panel of spec.panels) {
    for (const name of new Set(panel.queries.map((query) => query.connector))) {
      panels.set(name, (panels.get(name) ?? 0) + 1);
    }
  }
  const markers = new Set(spec.annotations.map((annotation) => annotation.query.connector));
  const names = [...new Set([...panels.keys(), ...markers])];
  return names.map((name) => {
    const count = panels.get(name) ?? 0;
    const used = count === 0 ? [] : [`${count} ${count === 1 ? 'panel' : 'panels'}`];
    return [name, [...used, ...(markers.has(name) ? ['markers'] : [])].join(' + ')];
  });
}

/** One version in the list, and what it can do. */
interface VersionRowProps {
  /** The dashboard. */
  readonly dashboard: DashboardData['dashboard'];
  /** The version. */
  readonly entry: DashboardData['dashboard']['versions'][number];
  /** Whether the screen shows this version. */
  readonly current: boolean;
  /** Makes it the version the library shows, for editors. */
  readonly onPin: ((version: number) => void) | undefined;
}

/**
 * When a version was made, short: the time today, else the day and the time.
 *
 * @param at - The time, in epoch milliseconds.
 * @returns Such as `14:02` or `28 Sep, 14:02`.
 */
function whenMade(at: number): string {
  const date = new Date(at);
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === new Date().toDateString()) return time;
  const day = date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return `${day}, ${time}`;
}

/**
 * One version: its number, linking to it unless it is on screen, when it was made, whether the
 * library shows it, and Pin for editors. What changed shows on hover.
 *
 * @param props - The dashboard, the version, whether it is on screen, and the pin callback.
 * @returns The row.
 */
function VersionRow({ dashboard, entry, current, onPin }: VersionRowProps) {
  const pinned = entry.version === dashboard.pinnedVersion;
  const label = `v${entry.version}`;
  return (
    <li data-current={current} data-pinned={pinned} title={entry.changeSummary ?? undefined}>
      {current ? (
        <strong aria-current="page">{label}</strong>
      ) : (
        <Link to={`/d/${dashboard.id}/v/${entry.version}`}>{label}</Link>
      )}
      <span className={styles.historyWhen}>{whenMade(entry.createdAt)}</span>
      {pinned && <Pill tone="ok">pinned</Pill>}
      {onPin && !pinned && (
        <Button size="small" aria-label={`Pin ${label}`} onClick={() => onPin(entry.version)}>
          Pin
        </Button>
      )}
    </li>
  );
}

/**
 * The versions, newest first, with Pin, and Unpin below for editors.
 *
 * @param props - The dashboard and the version shown.
 * @returns The versions.
 */
export function Versions({ dashboard, version }: DashboardData) {
  // The server says who may change it: the owner of its thread, or an admin.
  const canEdit = dashboard.canChange;
  const fetcher = useFetcher<Loaded<unknown>>();
  const submit = (intent: DashboardIntent) =>
    void fetcher.submit(intent as SubmitTarget, { method: 'post', encType: 'application/json' });
  const onPin = canEdit
    ? (pinned: number) => submit({ intent: 'pin', version: pinned })
    : undefined;
  return (
    <div className={styles.popoverBody} data-busy={fetcher.state !== 'idle'}>
      <ul className={styles.history}>
        {[...dashboard.versions].reverse().map((entry) => (
          <VersionRow
            key={entry.version}
            dashboard={dashboard}
            entry={entry}
            current={entry.version === version.version}
            onPin={onPin}
          />
        ))}
      </ul>
      {fetcher.data && !fetcher.data.ok && <p className={styles.error}>{fetcher.data.message}</p>}
      {canEdit && dashboard.pinnedVersion !== null && (
        <button type="button" className={styles.unpin} onClick={() => submit({ intent: 'unpin' })}>
          Unpin, and take it out of the library
        </button>
      )}
    </div>
  );
}

/**
 * What the dashboard is about, behind an info icon by its title: its description, tags and
 * sources.
 *
 * @param props - The dashboard and the version shown.
 * @returns The popover.
 */
export function AboutPopover(props: DashboardData) {
  return (
    <Popover label="About this dashboard" trigger={<InfoIcon />}>
      <AboutBody {...props} />
    </Popover>
  );
}

/**
 * What the dashboard is about: its description, tags and sources, with how each source is used.
 *
 * @param props - The dashboard and the version shown.
 * @returns The description, the tags and the sources.
 */
export function AboutBody({ dashboard, version }: DashboardData) {
  const { spec } = version;
  return (
    <div className={styles.popoverBody}>
      {spec.description ? (
        <p className={styles.about}>{spec.description}</p>
      ) : (
        <p className={styles.muted}>No description.</p>
      )}
      {dashboard.tags.length > 0 && (
        <p className={styles.tags}>{dashboard.tags.map((tag) => `#${tag}`).join(' ')}</p>
      )}
      <h2 className={styles.sideHeading}>Sources</h2>
      <dl className={styles.sources}>
        {sourcesOf(spec).map(([name, usage]) => (
          <div key={name} className={styles.source}>
            <dt>{name}</dt>
            <dd>{usage}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * The dashboard's versions, behind an icon button in the header named Versions, which says so
 * under it on hover and focus.
 *
 * @param props - The dashboard and the version shown.
 * @returns The popover.
 */
export function VersionsPopover(props: DashboardData) {
  return (
    <Popover
      label="Versions"
      tip="Versions"
      shape="iconButton"
      align="end"
      trigger={<HistoryIcon />}
    >
      <Versions {...props} />
    </Popover>
  );
}
