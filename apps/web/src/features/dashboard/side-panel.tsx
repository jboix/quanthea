/**
 * The side panel of a pinned dashboard, beside its panels: About, what the dashboard is about,
 * and Ask, its questions and answers. On a narrow screen it comes first, over the full width.
 */
import { Button } from '../../ui/button.tsx';
import { Tabs } from '../../ui/tabs.tsx';
import styles from './ask.module.css';
import type { OpenAnswer } from './ask-marks.ts';
import { AskTab } from './ask-tab.tsx';
import { AboutBody } from './dashboard-about.tsx';
import type { DashboardData } from './data.ts';

/** A tab of the side panel. */
export type SideTab = 'about' | 'ask';

/** The tabs, in order. */
const tabs: readonly { readonly id: SideTab; readonly label: string }[] = [
  { id: 'about', label: 'About' },
  { id: 'ask', label: 'Ask' },
];

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
 * The side panel: About and Ask, with a close button.
 *
 * @param props - The dashboard, the version shown, the tab and the callbacks.
 * @returns The panel.
 */
export function SidePanel({ tab, onTab, onClose, onOpenAnswer, ...data }: SidePanelProps) {
  return (
    <aside className={styles.side} aria-label="About and Ask">
      <div className={styles.sideTop}>
        <Tabs
          label="Dashboard side panel"
          tabs={tabs}
          selected={tab}
          onSelect={(id) => onTab(id as SideTab)}
        />
        <Button size="small" onClick={onClose} aria-label="Close the side panel">
          Close
        </Button>
      </div>
      {tab === 'about' ? (
        <div className={styles.aboutTab}>
          <AboutBody {...data} />
        </div>
      ) : (
        <AskTab {...data} onOpenAnswer={onOpenAnswer} />
      )}
    </aside>
  );
}
