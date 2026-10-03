/**
 * The Share menu of the dashboard header: copy the page's link, and for editors take a snapshot of
 * the view and see the dashboard's live snapshots.
 */
import { useState } from 'react';
import { ChevronDownIcon } from '../../ui/icons.tsx';
import { MenuItem } from '../../ui/menu-item.tsx';
import { Popover } from '../../ui/popover.tsx';
import styles from './dashboard.module.css';
import type { DashboardData } from './data.ts';
import { SnapshotList, TakeSnapshot, useLiveSnapshots } from './snapshot-menu.tsx';
import { snapshotsLabel } from './snapshot-words.ts';
import { useCanEdit } from './use-can-edit.ts';

/** The snapshot part of the menu that is open, if any. */
type SnapshotPart = 'take' | 'list';

/**
 * Copies the page's address, with its time range and variables, and says so for two seconds.
 *
 * @returns The item.
 */
function CopyLinkItem() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <MenuItem
      label={<span aria-live="polite">{copied ? 'Copied' : 'Copy link'}</span>}
      onClick={() => void copy()}
    />
  );
}

/**
 * The snapshot items, for editors: Take a snapshot opens the form under it, and the snapshots of
 * the dashboard, counted, open their list. One part shows at a time.
 *
 * @param props - The dashboard and the version shown.
 * @returns The items and the part open.
 */
function SnapshotItems(props: DashboardData) {
  const [open, setOpen] = useState<SnapshotPart | null>(null);
  const live = useLiveSnapshots(props.dashboard.id);
  const toggle = (part: SnapshotPart) => setOpen((current) => (current === part ? null : part));
  return (
    <>
      <MenuItem
        label="Take a snapshot…"
        aria-expanded={open === 'take'}
        onClick={() => toggle('take')}
      />
      {open === 'take' && <TakeSnapshot {...props} />}
      <MenuItem
        label={snapshotsLabel(live?.ok ? live.value.length : undefined)}
        aria-expanded={open === 'list'}
        onClick={() => toggle('list')}
      />
      {open === 'list' && <SnapshotList loaded={live} timeZone={props.version.spec.timezone} />}
    </>
  );
}

/**
 * What the Share menu holds: Copy link, and the snapshot items for editors.
 *
 * @param props - The dashboard and the version shown.
 * @returns The items.
 */
export function ShareMenu(props: DashboardData) {
  const canEdit = useCanEdit();
  return (
    <div className={styles.menu}>
      <CopyLinkItem />
      {canEdit && <SnapshotItems {...props} />}
    </div>
  );
}

/**
 * The Share button of the header, which opens the menu.
 *
 * @param props - The dashboard and the version shown.
 * @returns The popover.
 */
export function SharePopover(props: DashboardData) {
  return (
    <Popover
      label="Share"
      shape="button"
      align="end"
      trigger={
        <>
          Share <ChevronDownIcon />
        </>
      }
    >
      <ShareMenu {...props} />
    </Popover>
  );
}
