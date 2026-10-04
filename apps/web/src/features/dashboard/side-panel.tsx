/**
 * The side panel of a pinned dashboard, on the right from the top of the screen to the bottom, with
 * its own scroll: About, what the dashboard is about; Ask, one conversation about it; History, its
 * past conversations. On a narrow screen it covers the whole screen.
 */
import { type KeyboardEvent, useEffect } from 'react';
import { Button } from '../../ui/button.tsx';
import { Tabs, tabPanelProps } from '../../ui/tabs.tsx';
import styles from './ask.module.css';
import { HistoryTab } from './ask-history.tsx';
import type { OpenAnswer } from './ask-marks.ts';
import { AskTab } from './ask-tab.tsx';
import { AboutBody } from './dashboard-about.tsx';
import type { DashboardData } from './data.ts';
import { useConversation } from './use-conversation.ts';

/** A tab of the side panel. */
export type SideTab = 'about' | 'ask' | 'history';

/** The tabs, in order. */
const tabs: readonly { readonly id: SideTab; readonly label: string }[] = [
  { id: 'about', label: 'About' },
  { id: 'ask', label: 'Ask' },
  { id: 'history', label: 'History' },
];

/** The name of the panel's tabs and their panels. */
const panels = 'dashboard-side';

/** Props of {@link SidePanel}. */
interface SidePanelProps extends DashboardData {
  /** The tab shown. */
  readonly tab: SideTab;
  /** Shows another tab. */
  readonly onTab: (tab: SideTab) => void;
  /** Closes the panel. */
  readonly onClose: () => void;
  /** Receives the answer the dashboard should mark. */
  readonly onOpenAnswer: (open: OpenAnswer | undefined) => void;
}

/**
 * The open conversation, telling the dashboard which answer marks the charts.
 *
 * @param data - The dashboard and the version shown.
 * @param onOpenAnswer - Receives the answer that marks the charts.
 * @returns The conversation.
 */
function useMarkedConversation(data: DashboardData, onOpenAnswer: SidePanelProps['onOpenAnswer']) {
  const conversation = useConversation(data);
  const { marks } = conversation;
  useEffect(() => onOpenAnswer(marks), [marks, onOpenAnswer]);
  return conversation;
}

/**
 * Whether a key went to a text field that holds text, where Escape must not close the panel.
 *
 * @param target - Where the key went.
 * @returns Whether it is an input or a text area with a value.
 */
function holdsText(target: EventTarget): boolean {
  const field = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
  return field && target.value !== '';
}

/**
 * The key handler that closes the panel on Escape, unless the key went to a text field that holds
 * text or a field already handled it.
 *
 * @param onClose - Closes the panel.
 * @returns The handler.
 */
function closeOnEscape(onClose: () => void) {
  return (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented || holdsText(event.target)) return;
    onClose();
  };
}

/**
 * The top of the panel: the tabs and Close.
 *
 * @param props - The tab shown and the callbacks.
 * @returns The bar.
 */
function SideTop({ tab, onTab, onClose }: Pick<SidePanelProps, 'tab' | 'onTab' | 'onClose'>) {
  return (
    <div className={styles.sideTop}>
      <Tabs
        label="Dashboard side panel"
        tabs={tabs}
        selected={tab}
        onSelect={(id) => onTab(id as SideTab)}
        panels={panels}
      />
      <Button size="small" onClick={onClose} aria-label="Close the side panel">
        Close
      </Button>
    </div>
  );
}

/**
 * The side panel: About, Ask and History, with a close button. Escape closes it too, unless it
 * goes to a text field that holds text.
 *
 * @param props - The dashboard, the version shown, the tab and the callbacks.
 * @returns The panel.
 */
export function SidePanel({ tab, onTab, onClose, onOpenAnswer, ...data }: SidePanelProps) {
  const conversation = useMarkedConversation(data, onOpenAnswer);
  const open = (conversationId: string, questionId: string | undefined) => {
    conversation.show(conversationId, questionId);
    onTab('ask');
  };
  return (
    <aside
      className={styles.side}
      aria-label="About, Ask and History"
      onKeyDown={closeOnEscape(onClose)}
    >
      <SideTop tab={tab} onTab={onTab} onClose={onClose} />
      <div className={styles.sideBody} {...tabPanelProps(panels, tab)}>
        {tab === 'about' && (
          <div className={styles.aboutTab}>
            <AboutBody {...data} />
          </div>
        )}
        {tab === 'ask' && (
          <AskTab {...data} conversation={conversation} onHistory={() => onTab('history')} />
        )}
        {tab === 'history' && (
          <HistoryTab
            dashboardId={data.dashboard.id}
            timeZone={conversation.shown.timeZone}
            openId={conversation.conversationId}
            onOpen={open}
            onBinned={(conversationId) => {
              if (conversationId === conversation.conversationId) conversation.startNew();
            }}
          />
        )}
      </div>
    </aside>
  );
}
