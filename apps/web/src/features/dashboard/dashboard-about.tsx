import type { DashboardSpec } from '@querent/shared';
import { Link, type SubmitTarget, useFetcher } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { HistoryIcon, QuestionIcon } from '../../ui/icons.tsx';
import { Popover } from '../../ui/popover.tsx';
import styles from './dashboard.module.css';
import type { DashboardData, DashboardIntent, Loaded } from './data.ts';
import { useCanEdit } from './use-can-edit.ts';
import { versionNote } from './version-note.ts';

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

/** One version in the history, and what it can do. */
interface HistoryRowProps {
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
 * One version: a link to it, what it is, and Pin for editors when the library shows another.
 *
 * @param props - The dashboard, the version, whether it is on screen, and the pin callback.
 * @returns The row.
 */
function HistoryRow({ dashboard, entry, current, onPin }: HistoryRowProps) {
  const label = `v${entry.version} · ${versionNote(entry, dashboard.pinnedVersion)}`;
  return (
    <li data-current={current} data-pinned={entry.version === dashboard.pinnedVersion}>
      {current ? (
        <strong aria-current="page">{label}</strong>
      ) : (
        <Link to={`/d/${dashboard.id}/v/${entry.version}`}>{label}</Link>
      )}
      {onPin && entry.version !== dashboard.pinnedVersion && (
        <Button
          size="small"
          aria-label={`Pin v${entry.version}`}
          onClick={() => onPin(entry.version)}
        >
          Pin
        </Button>
      )}
    </li>
  );
}

/**
 * The history: every version the role may see, the one on screen highlighted. Editors can pin
 * any version, which is how a bad change is undone, or unpin the dashboard.
 *
 * @param props - The dashboard and the version shown.
 * @returns The list and its actions.
 */
function History({ dashboard, version }: DashboardData) {
  const canEdit = useCanEdit();
  const fetcher = useFetcher<Loaded<unknown>>();
  const submit = (intent: DashboardIntent) =>
    void fetcher.submit(intent as SubmitTarget, { method: 'post', encType: 'application/json' });
  const onPin = canEdit
    ? (pinned: number) => submit({ intent: 'pin', version: pinned })
    : undefined;
  return (
    <div className={styles.popoverBody} data-busy={fetcher.state !== 'idle'}>
      <ul className={styles.history}>
        {dashboard.versions.map((entry) => (
          <HistoryRow
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
        <div className={styles.unpin}>
          <span className={styles.muted}>Unpinning takes it out of the library.</span>
          <Button size="small" onClick={() => submit({ intent: 'unpin' })}>
            Unpin
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * What the dashboard is about, behind a question mark by its title: its description, tags and
 * sources.
 *
 * @param props - The dashboard and the version shown.
 * @returns The popover.
 */
export function AboutPopover({ dashboard, version }: DashboardData) {
  const { spec } = version;
  return (
    <Popover label="About this dashboard" trigger={<QuestionIcon />}>
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
    </Popover>
  );
}

/**
 * The dashboard's versions, behind a History button in the header.
 *
 * @param props - The dashboard and the version shown.
 * @returns The popover.
 */
export function HistoryPopover(props: DashboardData) {
  return (
    <Popover
      label="History"
      shape="button"
      align="end"
      trigger={
        <>
          <HistoryIcon /> History
        </>
      }
    >
      <History {...props} />
    </Popover>
  );
}
