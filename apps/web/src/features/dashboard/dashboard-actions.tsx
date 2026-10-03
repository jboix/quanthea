import { Button } from '../../ui/button.tsx';
import { MoreIcon, QuestionIcon } from '../../ui/icons.tsx';
import { MenuItem } from '../../ui/menu-item.tsx';
import { Popover } from '../../ui/popover.tsx';
import { useMediaQuery } from '../../ui/use-media-query.ts';
import { ChangeMenu, ChangePopover } from './change-menu.tsx';
import styles from './dashboard.module.css';
import { History, HistoryPopover } from './dashboard-about.tsx';
import type { DashboardData } from './data.ts';
import { ShareMenu, SharePopover } from './share-menu.tsx';
import { useCanEdit } from './use-can-edit.ts';

/** Below this width the header actions fold into one menu. */
const narrowScreen = '(max-width: 720px)';

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
 * The actions folded into one menu on a narrow screen: Ask about this, then the Change, Share and
 * History sections, with the same names and hints as the header's menus.
 *
 * @param props - The dashboard, the version shown, the way into the Ask tab, and the closer.
 * @param props.close - Closes the menu.
 * @returns The menu's content.
 */
function FoldedActions({
  onAsk,
  close,
  ...props
}: DashboardData & AskAction & { close: () => void }) {
  const canEdit = useCanEdit();
  return (
    <div className={styles.actionMenu}>
      {onAsk && <MenuItem label="Ask about this" onClick={() => closeThen(close, onAsk)} />}
      {canEdit && <h2 className={styles.sideHeading}>Change</h2>}
      <ChangeMenu {...props} />
      <h2 className={styles.sideHeading}>Share</h2>
      <ShareMenu {...props} />
      <h2 className={styles.sideHeading}>History</h2>
      <History {...props} />
    </div>
  );
}

/**
 * The header's actions: Ask about this, Change for editors, Share and History. On a narrow screen
 * they fold into one menu.
 *
 * @param props - The dashboard, the version shown, and the way into the Ask tab.
 * @returns The actions.
 */
export function HeaderActions({ onAsk, asking, ...props }: DashboardData & AskAction) {
  const narrow = useMediaQuery(narrowScreen);
  if (narrow) {
    return (
      <Popover label="Dashboard actions" trigger={<MoreIcon />} align="end">
        {(close) => <FoldedActions {...props} onAsk={onAsk} close={close} />}
      </Popover>
    );
  }
  return (
    <div className={styles.headerActions}>
      <AskButton onAsk={onAsk} asking={asking} />
      <ChangePopover {...props} />
      <SharePopover {...props} />
      <HistoryPopover {...props} />
    </div>
  );
}
