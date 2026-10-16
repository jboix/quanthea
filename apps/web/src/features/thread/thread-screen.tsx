import { isDashboardPlan, type Plan, type ThreadDetail } from '@quanthea/shared';
import type { ReactNode } from 'react';
import { AlertDraftPane } from '../alert-draft/index.ts';
import { ReportDraftPane } from '../report-draft/index.ts';
import { DraftPane } from './draft-pane.tsx';
import type { ThreadMessage } from './messages.ts';
import { bodyOfRequest, builderRequestOf } from './panel-body.ts';
import { buildStopped } from './repairs.ts';
import styles from './thread.module.css';
import { type ScreenState, ThreadPane } from './thread-pane.tsx';
import {
  DraftViewButton,
  OpenDraftButton,
  type ThreadView,
  useThreadView,
} from './thread-view.tsx';
import { useThread } from './use-thread.ts';

/**
 * The panels the latest person's message mentions, to mark them on the draft.
 *
 * @param messages - The messages.
 * @returns The panel ids.
 */
function lastMentions(messages: readonly ThreadMessage[]): string[] {
  const last = messages.findLast((message) => message.role === 'user');
  return (last?.metadata?.mentions ?? []).map((mention) => mention.panelId);
}

/**
 * The thread's latest plan, when it is a dashboard plan.
 *
 * @param thread - The thread.
 * @returns The plan, if any.
 */
function dashboardPlanOf(thread: ThreadDetail): Plan | undefined {
  const body = thread.plans.at(-1)?.body;
  return body && isDashboardPlan(body) ? body : undefined;
}

/**
 * The draft pane of an alert thread, with its actions.
 *
 * @param props - The screen's state and the view button.
 * @param props.state - The screen's state.
 * @param props.viewButton - The button that shows the draft full screen, or the thread again.
 * @returns The pane.
 */
function AlertPane({
  state,
  viewButton,
}: {
  readonly state: ScreenState;
  readonly viewButton: ReactNode;
}) {
  const { data, running, intents, alertActions } = state;
  const outcome = intents.outcome;
  const notice = outcome?.message ? { text: outcome.message, failed: !outcome.ok } : undefined;
  return (
    <AlertDraftPane
      viewButton={viewButton}
      threadId={data.thread.id}
      draft={data.alertDraft}
      busy={running || intents.busy || data.thread.readOnly}
      notice={notice}
      onHandEdit={(spec) => void alertActions.handEdit(spec)}
      onActivate={(alertId, version) => void alertActions.activate(alertId, version)}
      onTest={(alertId, version, series) => void alertActions.test(alertId, version, series)}
    />
  );
}

/**
 * The draft pane of a report thread, with its actions.
 *
 * @param props - The screen's state and the view button.
 * @param props.state - The screen's state.
 * @param props.viewButton - The button that shows the draft full screen, or the thread again.
 * @returns The pane.
 */
function ReportPane({
  state,
  viewButton,
}: {
  readonly state: ScreenState;
  readonly viewButton: ReactNode;
}) {
  const { data, running, intents, reportActions } = state;
  const outcome = intents.outcome;
  const notice = outcome?.message ? { text: outcome.message, failed: !outcome.ok } : undefined;
  return (
    <ReportDraftPane
      viewButton={viewButton}
      threadId={data.thread.id}
      draft={data.reportDraft}
      busy={running || intents.busy || data.thread.readOnly}
      notice={notice}
      onHandEdit={(spec) => void reportActions.handEdit(spec)}
      onActivate={(reportId, version) => void reportActions.activate(reportId, version)}
      onTest={(reportId, version) => void reportActions.test(reportId, version)}
    />
  );
}

/**
 * The draft pane of a dashboard thread, with its actions.
 *
 * @param props - The screen's state, the view button, and Ask about this panel.
 * @param props.state - The screen's state.
 * @param props.viewButton - The button that shows the draft full screen, or the thread again.
 * @param props.onMentionPanel - Puts a panel's mention in the composer.
 * @returns The pane.
 */
function DashboardPane({
  state,
  viewButton,
  onMentionPanel,
}: {
  readonly state: ScreenState;
  readonly viewButton: ReactNode;
  readonly onMentionPanel: (panelId: string) => void;
}) {
  const { data, chat, running, intents, selection, actions } = state;
  return (
    <DraftPane
      data={data}
      plan={dashboardPlanOf(data.thread)}
      running={running}
      stopped={buildStopped(chat.messages)}
      selectedPanelId={selection.selectedPanelId}
      onSelectPanel={selection.setSelectedPanelId}
      onMentionPanel={onMentionPanel}
      bodyOf={(panel) => {
        const request = builderRequestOf(chat.messages, panel);
        return request ? bodyOfRequest(request) : undefined;
      }}
      markedPanelIds={lastMentions(chat.messages)}
      onShowVersion={state.showVersion}
      onPin={(version) => void actions.pin(version)}
      onUnpin={() => void actions.unpin()}
      busy={intents.busy}
      viewButton={viewButton}
    />
  );
}

/**
 * The draft pane of the thread's kind.
 *
 * @param props - The screen's state, the view and its setter.
 * @param props.state - The screen's state.
 * @param props.view - The view shown.
 * @param props.onView - Changes it.
 * @returns The pane.
 */
function ThreadDraft({
  state,
  view,
  onView,
}: {
  readonly state: ScreenState;
  readonly view: ThreadView;
  readonly onView: (view: ThreadView) => void;
}) {
  const kind = state.data.thread.kind;
  const viewButton = <DraftViewButton view={view} onView={onView} noun={kind} />;
  if (kind === 'alert') return <AlertPane state={state} viewButton={viewButton} />;
  if (kind === 'report') return <ReportPane state={state} viewButton={viewButton} />;
  const onMentionPanel = (panelId: string) => {
    onView('split');
    state.mentionPanel(panelId);
  };
  return <DashboardPane state={state} viewButton={viewButton} onMentionPanel={onMentionPanel} />;
}

/**
 * The thread screen: the conversation on the left, the draft the agent builds on the right. The
 * draft can show alone, full screen; on a phone the conversation shows alone until the person
 * opens the draft.
 *
 * @returns The screen.
 */
export function ThreadScreen() {
  const state = useThread();
  const { view, show } = useThreadView();
  const noun = state.data.thread.kind;
  return (
    <div className={styles.screen} data-view={view}>
      <ThreadPane
        state={state}
        openDraft={<OpenDraftButton view={view} onView={show} noun={noun} />}
      />
      <ThreadDraft state={state} view={view} onView={show} />
    </div>
  );
}
