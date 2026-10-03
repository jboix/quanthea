/**
 * The Change menu of the dashboard header, for editors: edit the dashboard with the agent in the
 * conversation that built it, or start a new dashboard from a copy of the version shown.
 */
import { Link, type SubmitTarget, useFetcher } from 'react-router';
import { ChevronDownIcon } from '../../ui/icons.tsx';
import { MenuItem, MenuItemText, menuItemClassName } from '../../ui/menu-item.tsx';
import { Popover } from '../../ui/popover.tsx';
import { type ChangeItem, changeItems, changeWords } from './change-items.ts';
import styles from './dashboard.module.css';
import type { DashboardData, DashboardIntent, Loaded } from './data.ts';
import { useCanEdit } from './use-can-edit.ts';

/** Props of {@link ChangeEntry}. */
interface ChangeEntryProps {
  /** The item. */
  readonly item: ChangeItem;
  /** Submits an intent to the dashboard's action. */
  readonly submit: (intent: DashboardIntent) => void;
  /** Whether a submission is on its way. */
  readonly busy: boolean;
  /** The version shown, which a copy starts from. */
  readonly version: number;
}

/**
 * One item of the Change menu: a link to the thread or the bin, or a button that starts a thread.
 *
 * @param props - The item, the submitter, whether one is on its way, and the version shown.
 * @returns The link or the button.
 */
function ChangeEntry({ item, submit, busy, version }: ChangeEntryProps) {
  const words = changeWords(item);
  if (item.kind === 'open-thread' || item.kind === 'thread-in-bin') {
    const to = item.kind === 'open-thread' ? `/threads/${item.threadId}` : '/bin';
    return (
      <Link to={to} className={menuItemClassName}>
        <MenuItemText {...words} />
      </Link>
    );
  }
  const intent: DashboardIntent =
    item.kind === 'copy' ? { intent: 'copy', version } : { intent: 'edit' };
  return <MenuItem {...words} disabled={busy} onClick={() => submit(intent)} />;
}

/**
 * What the Change menu holds, for editors: the way to edit the dashboard with the agent, and a new
 * dashboard from the version shown, with the error of the last try.
 *
 * @param props - The dashboard and the version shown.
 * @returns The items, or nothing for viewers and analysts.
 */
export function ChangeMenu({ dashboard, version }: DashboardData) {
  const canEdit = useCanEdit();
  const fetcher = useFetcher<Loaded<unknown>>();
  const items = changeItems(dashboard, canEdit);
  if (items.length === 0) return null;
  const submit = (intent: DashboardIntent) =>
    void fetcher.submit(intent as SubmitTarget, { method: 'post', encType: 'application/json' });
  return (
    <div className={styles.menu}>
      {items.map((item) => (
        <ChangeEntry
          key={item.kind}
          item={item}
          submit={submit}
          busy={fetcher.state !== 'idle'}
          version={version.version}
        />
      ))}
      {fetcher.data?.ok === false && <p className={styles.error}>{fetcher.data.message}</p>}
    </div>
  );
}

/**
 * The Change button of the header, for editors, which opens the menu.
 *
 * @param props - The dashboard and the version shown.
 * @returns The popover, or nothing for viewers and analysts.
 */
export function ChangePopover(props: DashboardData) {
  const canEdit = useCanEdit();
  if (!canEdit) return null;
  return (
    <Popover
      label="Change"
      shape="button"
      align="end"
      trigger={
        <>
          Change <ChevronDownIcon />
        </>
      }
    >
      <ChangeMenu {...props} />
    </Popover>
  );
}
