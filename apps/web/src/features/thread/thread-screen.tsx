import type { AccessLevel, ThreadDetail } from '@querent/shared';
import { useEffect, useRef } from 'react';
import { Composer } from './composer.tsx';
import { Conversation } from './conversation.tsx';
import { DraftPane } from './draft-pane.tsx';
import type { ThreadMessage } from './messages.ts';
import styles from './thread.module.css';
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
 * The line under the conversation: working, a refused decision, or the run's error.
 *
 * @param props - The screen's state.
 * @param props.state - The screen's state.
 * @returns The line, or nothing.
 */
function StatusLine({ state }: { readonly state: ScreenState }) {
  const outcome = state.intents.outcome;
  const error = state.chat.error?.message ?? (outcome?.ok === false ? outcome.message : undefined);
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
      Working…
    </p>
  );
}

/**
 * The thread's title and the connectors it can use.
 *
 * @param props - The thread.
 * @param props.thread - The thread.
 * @returns The header.
 */
function ThreadHeader({ thread }: { readonly thread: ThreadDetail }) {
  return (
    <header className={styles.head}>
      <h1 className={styles.title}>{thread.title ?? 'New thread'}</h1>
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
        model={thread.model}
        access={accessOf(thread)}
        running={running}
        onSend={composer.send}
        onStop={() => void chat.stop()}
      />
    </div>
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
  const { data, chat, running, intents, actions } = state;
  const { thread, dashboard } = data;
  const scroller = useStickToEnd(chat.messages);
  const levels = Object.fromEntries(thread.connectors.map((item) => [item.name, item.accessLevel]));
  return (
    <section className={styles.thread} aria-label="Thread">
      <ThreadHeader thread={thread} />
      <div ref={scroller} className={styles.scroller}>
        <Conversation
          messages={chat.messages}
          plans={thread.plans}
          levels={levels}
          latestVersion={dashboard?.versions.at(-1)?.version ?? 0}
          busy={running || intents.busy}
          onApprove={(planId) => void actions.approve(planId)}
          onEditPlan={(planId) => void actions.editPlan(planId)}
          onUndo={(target) => void actions.undo(target)}
          onCompare={state.showVersion}
        />
        <StatusLine state={state} />
      </div>
      <ThreadComposer state={state} />
    </section>
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
  return (
    <div className={styles.screen}>
      <ThreadPane state={state} />
      <DraftPane
        data={data}
        plan={data.thread.plans.at(-1)?.body}
        running={running}
        selectedPanelId={selection.selectedPanelId}
        onSelectPanel={selection.setSelectedPanelId}
        markedPanelIds={lastMentions(chat.messages)}
        onShowVersion={state.showVersion}
        onPin={(version) => void actions.pin(version)}
        busy={intents.busy}
      />
    </div>
  );
}
