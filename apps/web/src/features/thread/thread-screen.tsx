import {
  type AccessLevel,
  addUsage,
  isDashboardPlan,
  type Plan,
  pricesCheckedOn,
  type ThreadDetail,
  type TurnUsage,
} from '@quanthea/shared';
import { useEffect, useRef, useState } from 'react';
import { AlertDraftPane } from '../alert-draft/index.ts';
import { ReportDraftPane } from '../report-draft/index.ts';
import { chatErrorText } from './chat-error.ts';
import { Composer } from './composer.tsx';
import { Conversation } from './conversation.tsx';
import { DraftPane } from './draft-pane.tsx';
import { LineageBanner, SeedBanner } from './lineage-banner.tsx';
import type { ThreadMessage } from './messages.ts';
import { draftPanelsOf } from './plan-changes.ts';
import { buildStopped } from './repairs.ts';
import { RestrictedNotice } from './restricted-notice.tsx';
import styles from './thread.module.css';
import { costText } from './usage-line.tsx';
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
 * Keeps the conversation scrolled to the end while it grows.
 *
 * @param messages - The messages, whose changes trigger the scroll.
 * @returns The ref for the scrolling element.
 */
function useStickToEnd(messages: readonly ThreadMessage[]) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = scroller.current;
    if (element && messages.length > 0) element.scrollTop = element.scrollHeight;
  }, [messages]);
  return scroller;
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
 * The text of the first question.
 *
 * @param messages - The messages.
 * @returns The text, or `undefined` before the first question.
 */
function firstQuestion(messages: readonly ThreadMessage[]): string | undefined {
  const first = messages.find((message) => message.role === 'user');
  return first?.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join(' ');
}

/**
 * What the whole thread has cost so far, from its answers' usage.
 *
 * @param props - The messages.
 * @param props.messages - The messages, as the chat holds them.
 * @returns The cost, or nothing before the first answer with usage.
 */
function ThreadCost({ messages }: { readonly messages: readonly ThreadMessage[] }) {
  const usage = messages.reduce<TurnUsage>(
    (total, message) =>
      Object.entries(message.metadata?.usage ?? {}).reduce(
        (sum, [model, tokens]) => addUsage(sum, model, tokens),
        total,
      ),
    {},
  );
  if (Object.keys(usage).length === 0) return null;
  return (
    <span className={styles.cost} title={`At list prices checked on ${pricesCheckedOn}.`}>
      {costText(usage)} so far
    </span>
  );
}

/**
 * The thread's title, or its first question until the server names it, and the connectors it can
 * use.
 *
 * @param props - The thread and its messages.
 * @param props.thread - The thread.
 * @param props.messages - The messages, as the chat holds them.
 * @returns The header.
 */
function ThreadHeader({
  thread,
  messages,
}: {
  readonly thread: ThreadDetail;
  readonly messages: readonly ThreadMessage[];
}) {
  return (
    <header className={styles.head}>
      <h1 className={styles.title}>{thread.title ?? firstQuestion(messages) ?? 'New thread'}</h1>
      <ThreadCost messages={messages} />
      <span className={styles.connectors}>
        {thread.connectors.map((connector) => connector.name).join(' · ')}
      </span>
    </header>
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
 * @param props - The screen's state.
 * @param props.state - The screen's state.
 * @returns The pane.
 */
function ThreadPane({ state }: { readonly state: ScreenState }) {
  const { thread } = state.data;
  const scroller = useStickToEnd(state.chat.messages);
  return (
    <section className={styles.thread} aria-label="Thread">
      <ThreadHeader thread={thread} messages={state.chat.messages} />
      <div ref={scroller} className={styles.scroller}>
        {state.data.parent && <LineageBanner parent={state.data.parent} />}
        {state.data.origin && <SeedBanner origin={state.data.origin} />}
        <ThreadConversation state={state} />
        <StatusLine state={state} />
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
 * @param props - The screen's state.
 * @param props.state - The screen's state.
 * @returns The pane.
 */
function AlertPane({ state }: { readonly state: ScreenState }) {
  const { data, running, intents, alertActions } = state;
  const outcome = intents.outcome;
  const notice = outcome?.message ? { text: outcome.message, failed: !outcome.ok } : undefined;
  return (
    <AlertDraftPane
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
 * @param props - The screen's state.
 * @param props.state - The screen's state.
 * @returns The pane.
 */
function ReportPane({ state }: { readonly state: ScreenState }) {
  const { data, running, intents, reportActions } = state;
  const outcome = intents.outcome;
  const notice = outcome?.message ? { text: outcome.message, failed: !outcome.ok } : undefined;
  return (
    <ReportDraftPane
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
 * The thread screen: the conversation on the left, the draft the agent builds on the right.
 *
 * @returns The screen.
 */
export function ThreadScreen() {
  const state = useThread();
  const { data, chat, running, intents, selection, actions } = state;
  if (data.thread.kind !== 'dashboard')
    return (
      <div className={styles.screen}>
        <ThreadPane state={state} />
        {data.thread.kind === 'alert' ? <AlertPane state={state} /> : <ReportPane state={state} />}
      </div>
    );
  return (
    <div className={styles.screen}>
      <ThreadPane state={state} />
      <DraftPane
        data={data}
        plan={dashboardPlanOf(data.thread)}
        running={running}
        stopped={buildStopped(chat.messages)}
        selectedPanelId={selection.selectedPanelId}
        onSelectPanel={selection.setSelectedPanelId}
        markedPanelIds={lastMentions(chat.messages)}
        onShowVersion={state.showVersion}
        onPin={(version) => void actions.pin(version)}
        onUnpin={() => void actions.unpin()}
        busy={intents.busy}
      />
    </div>
  );
}
