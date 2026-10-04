/**
 * The side panel of a run, on the right from the top of the screen to the bottom, with its own
 * scroll: About, what the report is and reads; Ask, one conversation about the run; History, its
 * past conversations. Escape closes it, unless it goes to a text field that holds text. On a narrow
 * screen it covers the whole screen.
 */
import type { ReportRunDetail } from '@quanthea/shared';
import type { KeyboardEvent } from 'react';
import { Button } from '../../ui/button.tsx';
import { Tabs, tabPanelProps } from '../../ui/tabs.tsx';
import { accessLevelName } from '../connectors/index.ts';
import { HistoryTab } from '../dashboard/index.ts';
import styles from './run-ask.module.css';
import { useRunSources } from './run-ask-state.ts';
import { RunAskTab } from './run-ask-tab.tsx';
import { type RunConversationState, useRunConversation } from './use-run-conversation.ts';
import { scheduleLine } from './words.ts';

/** A tab of the side panel. */
export type RunSideTab = 'about' | 'ask' | 'history';

/** The tabs, in order. */
const tabs: readonly { readonly id: RunSideTab; readonly label: string }[] = [
  { id: 'about', label: 'About' },
  { id: 'ask', label: 'Ask' },
  { id: 'history', label: 'History' },
];

/** The name of the panel's tabs and their panels. */
const panels = 'run-side';

/** Props of {@link RunSidePanel}. */
interface RunSidePanelProps {
  /** The run. */
  readonly run: ReportRunDetail;
  /** The tab shown. */
  readonly tab: RunSideTab;
  /** Shows another tab. */
  readonly onTab: (tab: RunSideTab) => void;
  /** Closes the panel. */
  readonly onClose: () => void;
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
    const target = event.target;
    const field = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
    if (event.key !== 'Escape' || event.defaultPrevented || (field && target.value !== '')) return;
    onClose();
  };
}

/**
 * The About tab: the report's description, its schedule and period, the version that ran, and its
 * sources with their access levels.
 *
 * @param props - The run and the path of its resource routes.
 * @param props.run - The run.
 * @param props.base - The run's path.
 * @returns The tab's content.
 */
function AboutRun({ run, base }: { readonly run: ReportRunDetail; readonly base: string }) {
  const sources = useRunSources(base);
  return (
    <div className={styles.about}>
      {run.spec.description && <p className={styles.aboutText}>{run.spec.description}</p>}
      <p className={styles.meta}>
        {scheduleLine(run.spec.schedule, run.spec.period)} · {run.spec.schedule.timezone} · ran v
        {run.version}
      </p>
      <h3 className={styles.watchingTitle}>Sources</h3>
      <ul className={styles.sources}>
        {(sources ?? []).map((source) => (
          <li key={source.name}>
            <span className={styles.mono}>{source.name}</span> ·{' '}
            {source.accessLevel === null ? 'not configured' : accessLevelName(source.accessLevel)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The History tab of a run: its past conversations, the dashboard's History over the run's routes.
 *
 * @param props - The run, the open conversation and the tab callback.
 * @param props.run - The run.
 * @param props.conversation - The open conversation.
 * @param props.onTab - Shows another tab.
 * @returns The tab's content.
 */
function RunHistory({
  run,
  conversation,
  onTab,
}: {
  readonly run: ReportRunDetail;
  readonly conversation: RunConversationState;
  readonly onTab: (tab: RunSideTab) => void;
}) {
  return (
    <HistoryTab
      base={conversation.base}
      emptyText="No one has asked about this run yet."
      timeZone={run.spec.schedule.timezone}
      openId={conversation.conversationId}
      onOpen={(conversationId, questionId) => {
        conversation.show(conversationId, questionId);
        onTab('ask');
      }}
      onBinned={(conversationId) => {
        if (conversationId === conversation.conversationId) conversation.startNew();
      }}
    />
  );
}

/**
 * The side panel of a run.
 *
 * @param props - The run, the tab and the callbacks.
 * @returns The panel.
 */
export function RunSidePanel({ run, tab, onTab, onClose }: RunSidePanelProps) {
  const conversation = useRunConversation({ reportId: run.reportId, runId: run.id });
  return (
    <aside
      className={styles.side}
      aria-label="About, Ask and History"
      onKeyDown={closeOnEscape(onClose)}
    >
      <div className={styles.sideTop}>
        <Tabs
          label="Run side panel"
          tabs={tabs}
          selected={tab}
          onSelect={(id) => onTab(id as RunSideTab)}
          panels={panels}
        />
        <Button size="small" onClick={onClose} aria-label="Close the side panel">
          Close
        </Button>
      </div>
      <div className={styles.sideBody} {...tabPanelProps(panels, tab)}>
        {tab === 'about' && <AboutRun run={run} base={conversation.base} />}
        {tab === 'ask' && (
          <RunAskTab run={run} conversation={conversation} onHistory={() => onTab('history')} />
        )}
        {tab === 'history' && <RunHistory run={run} conversation={conversation} onTab={onTab} />}
      </div>
    </aside>
  );
}
