import { useState } from 'react';
import { Link, type SubmitTarget, useFetcher } from 'react-router';
import { Button, buttonClassName } from '../../ui/button.tsx';
import { BinIcon, CopyIcon, MoreIcon, QuestionIcon, ThreadsIcon } from '../../ui/icons.tsx';
import { Popover } from '../../ui/popover.tsx';
import { useMediaQuery } from '../../ui/use-media-query.ts';
import styles from './dashboard.module.css';
import { History, HistoryPopover } from './dashboard-about.tsx';
import type { DashboardData, DashboardIntent, Loaded } from './data.ts';
import { SnapshotMenu, SnapshotPopover } from './snapshot-menu.tsx';
import { useCanEdit } from './use-can-edit.ts';

/** Below this width the header actions fold into one menu. */
const narrowScreen = '(max-width: 720px)';

/**
 * Copies the page's address, and says so for two seconds.
 *
 * @returns The button.
 */
function CopyLinkButton() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return <Button onClick={() => void copy()}>{copied ? 'Copied' : 'Copy link'}</Button>;
}

/**
 * The way to the dashboard's thread: open it, find it in the bin, or start one when it has none.
 *
 * @param props - The dashboard, and the intent submitter.
 * @param props.dashboard - The dashboard.
 * @param props.onEdit - Opens a new thread on the dashboard.
 * @param props.busy - Whether a submission is on its way.
 * @returns The link or button.
 */
function ThreadLink({
  dashboard,
  onEdit,
  busy,
}: {
  readonly dashboard: DashboardData['dashboard'];
  readonly onEdit: () => void;
  readonly busy: boolean;
}) {
  if (dashboard.threadId !== null) {
    return (
      <Link to={`/threads/${dashboard.threadId}`} className={buttonClassName('secondary')}>
        <ThreadsIcon /> Open thread
      </Link>
    );
  }
  // Someone else's thread: it is theirs to open; a copy is on offer instead.
  if (dashboard.threadOfOther) return null;
  if (dashboard.threadBinned) {
    return (
      <Link to="/bin" className={buttonClassName('secondary')}>
        <BinIcon /> Thread in the bin
      </Link>
    );
  }
  return (
    <Button disabled={busy} onClick={onEdit}>
      <ThreadsIcon /> Edit in a new thread
    </Button>
  );
}

/**
 * For editors: the dashboard's thread, or a new thread on it when it has none, and a new
 * dashboard from the version shown.
 *
 * @param props - The dashboard and the version shown.
 * @returns The actions, or nothing for viewers.
 */
function ThreadActions({ dashboard, version }: DashboardData) {
  const canEdit = useCanEdit();
  const fetcher = useFetcher<Loaded<unknown>>();
  if (!canEdit) return null;
  const submit = (intent: DashboardIntent) =>
    void fetcher.submit(intent as SubmitTarget, { method: 'post', encType: 'application/json' });
  const busy = fetcher.state !== 'idle';
  return (
    <>
      <ThreadLink dashboard={dashboard} busy={busy} onEdit={() => submit({ intent: 'edit' })} />
      <Button disabled={busy} onClick={() => submit({ intent: 'copy', version: version.version })}>
        <CopyIcon /> New from this
      </Button>
      {fetcher.data?.ok === false && <span className={styles.error}>{fetcher.data.message}</span>}
    </>
  );
}

/** The header's way into the Ask tab. */
export interface AskAction {
  /** Opens the Ask tab; left out where questions can't be asked, off a pinned version. */
  readonly onAsk?: (() => void) | undefined;
  /** Whether the Ask tab is open. */
  readonly asking?: boolean | undefined;
}

/**
 * Opens the Ask tab, pressed while it is open.
 *
 * @param props - The callback and whether the tab is open.
 * @returns The button, or nothing where questions can't be asked.
 */
function AskButton({ onAsk, asking = false }: AskAction) {
  if (!onAsk) return null;
  return (
    <Button aria-pressed={asking} onClick={onAsk}>
      <QuestionIcon /> Ask about this
    </Button>
  );
}

/**
 * Closes the actions menu, then runs the action chosen in it, so the menu does not stay over what
 * the action opens.
 *
 * @param close - Closes the menu.
 * @param action - The action.
 */
function closeThen(close: () => void, action: () => void): void {
  close();
  action();
}

/**
 * The header's actions: History, Snapshot for editors, Ask about this, the thread, a new
 * dashboard from this one, and Copy link. On a narrow screen they fold into one menu, with the
 * history and the snapshots listed in it.
 *
 * @param props - The dashboard, the version shown, and the way into the Ask tab.
 * @returns The actions.
 */
export function HeaderActions({ onAsk, asking, ...props }: DashboardData & AskAction) {
  const narrow = useMediaQuery(narrowScreen);
  const canEdit = useCanEdit();
  if (!narrow) {
    return (
      <div className={styles.headerActions}>
        <HistoryPopover {...props} />
        {canEdit && <SnapshotPopover {...props} />}
        <AskButton onAsk={onAsk} asking={asking} />
        <ThreadActions {...props} />
        <CopyLinkButton />
      </div>
    );
  }
  return (
    <Popover label="Dashboard actions" trigger={<MoreIcon />} align="end">
      {(close) => (
        <div className={styles.actionMenu}>
          <AskButton onAsk={onAsk && (() => closeThen(close, onAsk))} asking={asking} />
          <ThreadActions {...props} />
          <CopyLinkButton />
          <h2 className={styles.sideHeading}>History</h2>
          <History {...props} />
          {canEdit && <h2 className={styles.sideHeading}>Snapshot</h2>}
          {canEdit && <SnapshotMenu {...props} />}
        </div>
      )}
    </Popover>
  );
}
