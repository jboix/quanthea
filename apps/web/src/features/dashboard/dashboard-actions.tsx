import { useState } from 'react';
import { Link, type SubmitTarget, useFetcher } from 'react-router';
import { Button, buttonClassName } from '../../ui/button.tsx';
import { CopyIcon, MoreIcon, ThreadsIcon } from '../../ui/icons.tsx';
import { Popover } from '../../ui/popover.tsx';
import { useMediaQuery } from '../../ui/use-media-query.ts';
import styles from './dashboard.module.css';
import { History, HistoryPopover } from './dashboard-about.tsx';
import type { DashboardData, DashboardIntent, Loaded } from './data.ts';
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
      {dashboard.threadId === null ? (
        <Button disabled={busy} onClick={() => submit({ intent: 'edit' })}>
          <ThreadsIcon /> Edit in a new thread
        </Button>
      ) : (
        <Link to={`/threads/${dashboard.threadId}`} className={buttonClassName('secondary')}>
          <ThreadsIcon /> Open thread
        </Link>
      )}
      <Button disabled={busy} onClick={() => submit({ intent: 'copy', version: version.version })}>
        <CopyIcon /> New from this
      </Button>
      {fetcher.data?.ok === false && <span className={styles.error}>{fetcher.data.message}</span>}
    </>
  );
}

/**
 * The header's actions: History, the thread, a new dashboard from this one, and Copy link. On a
 * narrow screen they fold into one menu, with the history listed in it.
 *
 * @param props - The dashboard and the version shown.
 * @returns The actions.
 */
export function HeaderActions(props: DashboardData) {
  const narrow = useMediaQuery(narrowScreen);
  if (!narrow) {
    return (
      <div className={styles.headerActions}>
        <HistoryPopover {...props} />
        <ThreadActions {...props} />
        <CopyLinkButton />
      </div>
    );
  }
  return (
    <Popover label="Dashboard actions" trigger={<MoreIcon />} align="end">
      <div className={styles.actionMenu}>
        <ThreadActions {...props} />
        <CopyLinkButton />
        <h2 className={styles.sideHeading}>History</h2>
        <History {...props} />
      </div>
    </Popover>
  );
}
