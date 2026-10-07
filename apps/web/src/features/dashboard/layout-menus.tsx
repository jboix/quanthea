/**
 * The edit bar's menus: the panels hidden on the layout, each shown again with one press, and the
 * layout's history, where an earlier arrangement is restored.
 */
import type { DashboardLayout, LayoutRevision } from '@quanthea/shared';
import { useEffect } from 'react';
import { useFetcher } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { Popover } from '../../ui/popover.tsx';
import type { Loaded } from './data.ts';
import { showPanel } from './layout-edit.ts';
import styles from './layout-editor.module.css';
import { dateTimeWords } from './snapshot-words.ts';

/** Props of {@link HiddenMenu}. */
interface HiddenMenuProps {
  /** The layout being edited. */
  readonly layout: DashboardLayout;
  /** Each panel's title, by id. */
  readonly titles: ReadonlyMap<string, string>;
  /** Changes the layout. */
  readonly onChange: (layout: DashboardLayout) => void;
}

/**
 * The panels the layout hides, each with Show, which puts it back at its place.
 *
 * @param props - The layout, the titles and the change callback.
 * @returns The menu, or nothing while no panel is hidden.
 */
export function HiddenMenu({ layout, titles, onChange }: HiddenMenuProps) {
  const hidden = layout.panels.filter((panel) => panel.hidden);
  if (hidden.length === 0) return null;
  return (
    <Popover label="Hidden panels" shape="button" trigger={`Hidden (${hidden.length})`} align="end">
      <ul className={styles.list}>
        {hidden.map((panel) => (
          <li key={panel.id} className={styles.row}>
            <span>{titles.get(panel.id) ?? panel.id}</span>
            <Button size="small" onClick={() => onChange(showPanel(layout, panel.id))}>
              Show
            </Button>
          </li>
        ))}
      </ul>
    </Popover>
  );
}

/** Props of {@link HistoryMenu}. */
interface HistoryMenuProps {
  /** The dashboard. */
  readonly dashboardId: string;
  /** The version arranged. */
  readonly version: number;
  /** Restores a revision. */
  readonly onRestore: (revision: number) => void;
}

/**
 * The layout's revisions, latest first, each earlier one with Restore. Restoring drops the edit
 * under way and shows the restored arrangement.
 *
 * @param props - The dashboard, the version and the restore callback.
 * @returns The menu.
 */
export function HistoryMenu(props: HistoryMenuProps) {
  return (
    <Popover label="Layout history" shape="button" trigger="History" align="end">
      {(close) => (
        <HistoryList
          {...props}
          onRestore={(revision) => {
            close();
            props.onRestore(revision);
          }}
        />
      )}
    </Popover>
  );
}

/**
 * The revisions, loaded when the menu opens.
 *
 * @param props - The dashboard, the version and the restore callback.
 * @returns The list.
 */
function HistoryList({ dashboardId, version, onRestore }: HistoryMenuProps) {
  const fetcher = useFetcher<Loaded<LayoutRevision[]>>();
  const { load } = fetcher;
  useEffect(() => {
    void load(`/d/${dashboardId}/v/${version}/layouts`);
  }, [load, dashboardId, version]);
  const result = fetcher.data;
  if (!result) return <p className={styles.note}>Loading…</p>;
  if (!result.ok) return <p className={styles.note}>{result.message}</p>;
  if (result.value.length === 0)
    return <p className={styles.note}>No layout saved yet: the version shows as it was built.</p>;
  return (
    <ul className={styles.list}>
      {result.value.map((entry, index) => (
        <li key={entry.revision} className={styles.row}>
          <span>
            <strong>{`Layout ${entry.revision}`}</strong>
            {` · ${entry.savedBy} · ${dateTimeWords(entry.createdAt)}`}
            {entry.restoredFrom !== null && ` · restores ${entry.restoredFrom}`}
          </span>
          {index === 0 ? (
            <span className={styles.note}>Shown</span>
          ) : (
            <Button size="small" onClick={() => onRestore(entry.revision)}>
              Restore
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
