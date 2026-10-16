/**
 * The left pane of a thread: its title, the conversation, the agent's progress, and the composer.
 * The definitions screen shows it beside the definitions, with a header of its own.
 */
import type { AccessLevel, ThreadDetail } from '@quanthea/shared';
import { type ReactNode, useEffect, useState } from 'react';
import { NewBelow } from '../../ui/new-below.tsx';
import { useFollowEnd } from '../../ui/use-follow-end.ts';
import { chatErrorText } from './chat-error.ts';
import { Composer } from './composer.tsx';
import { Conversation } from './conversation.tsx';
import { LineageBanner, SeedBanner } from './lineage-banner.tsx';
import type { ThreadMessage } from './messages.ts';
import { draftPanelsOf } from './plan-changes.ts';
import { RestrictedNotice } from './restricted-notice.tsx';
import styles from './thread.module.css';
import { ThreadHeader } from './thread-header.tsx';
import type { useThread } from './use-thread.ts';

/** The composer chip's words for each access level. */
const accessNames: Readonly<Record<AccessLevel, string>> = {
  1: 'schema only',
  2: 'metadata',
  3: 'aggregates',
  4: 'full access',
};

/** The screen's state, as {@link useThread} returns it. */
export type ScreenState = ReturnType<typeof useThread>;

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
 * @param props - The screen's state, the button that opens the draft on a phone, and a header of
 *   the caller's.
 * @param props.state - The screen's state.
 * @param props.openDraft - The button that opens the draft where it does not fit beside.
 * @param props.header - A header in place of the thread's title and connectors.
 * @returns The pane.
 */
export function ThreadPane({
  state,
  openDraft,
  header,
}: {
  readonly state: ScreenState;
  readonly openDraft: ReactNode;
  readonly header?: ReactNode;
}) {
  const { thread } = state.data;
  const follow = useConversationEnd(thread.id, state.chat.messages);
  return (
    <section className={styles.thread} aria-label="Thread">
      {header ?? (
        <ThreadHeader thread={thread} messages={state.chat.messages} openDraft={openDraft} />
      )}
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
