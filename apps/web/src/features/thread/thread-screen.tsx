import { type AccessLevel, isDashboardPlan, type Plan, type ThreadDetail } from '@quanthea/shared';
import { type ReactNode, useEffect, useState } from 'react';
import { NewBelow } from '../../ui/new-below.tsx';
import { useFollowEnd } from '../../ui/use-follow-end.ts';
import { AlertDraftPane } from '../alert-draft/index.ts';
import { ReportDraftPane } from '../report-draft/index.ts';
import { chatErrorText } from './chat-error.ts';
import { Composer } from './composer.tsx';
import { Conversation } from './conversation.tsx';
import { DraftPane } from './draft-pane.tsx';
import { LineageBanner, SeedBanner } from './lineage-banner.tsx';
import type { ThreadMessage } from './messages.ts';
import { bodyOfRequest, builderRequestOf } from './panel-body.ts';
import { draftPanelsOf } from './plan-changes.ts';
import { buildStopped } from './repairs.ts';
import { RestrictedNotice } from './restricted-notice.tsx';
import styles from './thread.module.css';
import { ThreadHeader } from './thread-header.tsx';
import {
  DraftViewButton,
  OpenDraftButton,
  type ThreadView,
  useThreadView,
} from './thread-view.tsx';
import { useThread } from './use-thread.ts';

/** The composer chip's words for each access level. */
const accessNames: Readonly<Record<AccessLevel, string>> = {
  1: 'schema only',
  2: 'metadata',
  3: 'aggregates',
  4: 'full access',
};

/** The screen's state, as {@link useThread} returns it. */
type ScreenState = ReturnType<typeof useThread>;

/**
 * The lowest access level of the thread's connectors, which bounds what the model can see.
 *
 * @param thread - The thread.
 * @returns The chip's words.
 */
function accessOf(thread: ThreadDetail): string {
  const levels = thread.connectors.map((connector) => connector.accessLevel);
  if (levels.length === 0) return 'no connectors';
  return accessNames[Math.min(...levels) as AccessLevel];
}

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
 * Follows the end of the conversation while the person is there, and leaves the scroll alone once
 * they scroll up to read, counting the messages that arrive below. Sending a message, or opening
 * another thread, goes to the end.
 *
 * @param threadId - The thread.
 * @param messages - The messages, whose growth the scroll follows.
 * @returns The ref and scroll handler of the scrolling element, what is unseen, and the way down.
 */
function useConversationEnd(threadId: string, messages: readonly ThreadMessage[]) {
  const last = messages.at(-1);
  const tail = JSON.stringify(last?.parts.at(-1) ?? null).length;
  const sent = messages.filter((message) => message.role === 'user').length;
  return useFollowEnd<HTMLDivElement>({
    growth: messages.length === 0 ? '' : `${messages.length}:${last?.parts.length}:${tail}`,
    count: messages.length,
    restart: `${threadId}:${sent}`,
  });
}

/**
 * The seconds since the agent started working, counted while it works.
 *
 * @param running - Whether the agent is working.
 * @returns The whole seconds, 0 when idle.
 */
function useElapsedSeconds(running: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    setSeconds(0);
    if (!running) return;
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return seconds;
}

/**
 * What the agent is doing, in the words of the progress line.
 *
 * @param state - The screen's state.
 * @returns Such as `Thinking`, before anything streams, or `Working` after.
 */
function activityOf(state: ScreenState): string {
  const last = state.chat.messages.at(-1);
  return state.chat.status === 'submitted' || last?.role === 'user' ? 'Thinking' : 'Working';
}

/**
 * The line under the conversation: what the agent is doing and for how long, a refused decision,
 * or the run's error.
 *
 * @param props - The screen's state.
 * @param props.state - The screen's state.
 * @returns The line, or nothing.
 */
function StatusLine({ state }: { readonly state: ScreenState }) {
  const seconds = useElapsedSeconds(state.running);
  const outcome = state.intents.outcome;
  const error =
    chatErrorText(state.chat.error) ?? (outcome?.ok === false ? outcome.message : undefined);
  if (error !== undefined) {
    return (
      <p className={styles.error} role="alert">
        {error}
      </p>
    );
  }
  if (!state.running) return null;
  return (
    <p className={styles.working} role="status">
      <span className={styles.dot} />
      {activityOf(state)}… {seconds >= 3 ? `${seconds} s` : ''}
    </p>
  );
}

/**
 * The composer, with the draft's panels to mention and the model and access chips.
 *
 * @param props - The screen's state.
 * @param props.state - The screen's state.
 * @returns The composer.
 */
function ThreadComposer({ state }: { readonly state: ScreenState }) {
  const { chat, running, composer } = state;
  const { thread, version } = state.data;
  return (
    <div className={styles.composer}>
      <Composer
        draft={composer.draft}
        onDraft={composer.setDraft}
        panels={version?.spec.panels.map(({ id, title }) => ({ id, title })) ?? []}
        model={`${thread.model} · ${thread.providerName}`}
        access={accessOf(thread)}
        running={running}
        onSend={composer.send}
        onStop={() => void chat.stop()}
      />
    </div>
  );
}

/**
 * The conversation with the thread's actions wired in.
 *
 * @param props - The screen's state.
 * @param props.state - The screen's state.
 * @returns The conversation.
 */
function ThreadConversation({ state }: { readonly state: ScreenState }) {
  const { chat, running, intents, actions } = state;
  const { thread, dashboard, version } = state.data;
  const levels = Object.fromEntries(thread.connectors.map((item) => [item.name, item.accessLevel]));
  const latest = version && version.version === dashboard?.versions.at(-1)?.version;
  return (
    <Conversation
      messages={chat.messages}
      plans={thread.plans}
      levels={levels}
      definitions={state.data.definitions}
      latestVersion={dashboard?.versions.at(-1)?.version ?? 0}
      busy={running || intents.busy || thread.readOnly}
      onApprove={(planId) => void actions.approve(planId)}
      onEditPlan={(planId) => void actions.editPlan(planId)}
      onUndo={(target) => void actions.undo(target)}
      onCompare={state.showVersion}
      onAnswer={(answer) => state.composer.send(answer)}
      onStartFrom={(dashboardId) => void actions.startFrom(dashboardId)}
      onBuildNew={actions.buildNew}
      onTryAgain={actions.tryAgain}
      hasDraft={dashboard !== null}
      draftPanels={latest ? draftPanelsOf(version.spec) : undefined}
    />
  );
}

/**
 * The left pane: the thread's title and connectors, the conversation, and the composer.
 *
 * @param props - The screen's state, and the button that opens the draft on a phone.
 * @param props.state - The screen's state.
 * @param props.openDraft - The button that opens the draft where it does not fit beside.
 * @returns The pane.
 */
function ThreadPane({
  state,
  openDraft,
}: {
  readonly state: ScreenState;
  readonly openDraft: ReactNode;
}) {
  const { thread } = state.data;
  const follow = useConversationEnd(thread.id, state.chat.messages);
  return (
    <section className={styles.thread} aria-label="Thread">
      <ThreadHeader thread={thread} messages={state.chat.messages} openDraft={openDraft} />
      <div ref={follow.ref} onScroll={follow.onScroll} className={styles.scroller}>
        {state.data.parent && <LineageBanner parent={state.data.parent} />}
        {state.data.origin && <SeedBanner origin={state.data.origin} />}
        <ThreadConversation state={state} />
        <StatusLine state={state} />
        <NewBelow unseen={follow.unseen} noun="message" onJump={follow.jump} />
      </div>
      {thread.restrictedData && <RestrictedNotice />}
      {thread.readOnly ? (
        <p className={styles.readOnly} role="note">
          {thread.ownerName}’s thread. Admins can read it; only {thread.ownerName} can write in it.
        </p>
      ) : (
        <ThreadComposer state={state} />
      )}
    </section>
  );
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
