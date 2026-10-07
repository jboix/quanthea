/**
 * The Ask tab of a pinned dashboard: one conversation, newest at the bottom, and, for analysts and
 * above, the question box pinned under it. Each question continues the conversation, about the
 * dashboard as it is shown then: its range, its variables and its version. New conversation starts
 * over; History holds the others.
 */
import type { Conversation } from '@quanthea/shared';
import { useCallback, useState } from 'react';
import { Button } from '../../ui/button.tsx';
import { NewBelow } from '../../ui/new-below.tsx';
import { useFollowEnd } from '../../ui/use-follow-end.ts';
import styles from './ask.module.css';
import { ConfirmBin, useBinConversation } from './ask-bin.tsx';
import { askedContextOf, contextChange } from './ask-conversation.ts';
import { AskForm, ExplainOnlyCard, SimilarQuestions, WhoCanAsk } from './ask-form.tsx';
import { LiveTurn, StoredTurn } from './ask-message.tsx';
import { useCanAsk, useConversations, useSimilar, useSources } from './ask-state.ts';
import { dayLabel, instantLabel } from './ask-words.ts';
import type { DashboardData } from './data.ts';
import type { useConversation } from './use-conversation.ts';

/** The conversation's state, as {@link useConversation} gives it. */
type ConversationState = ReturnType<typeof useConversation>;

/** Props of {@link AskTab}. */
interface AskTabProps extends DashboardData {
  /** The open conversation. */
  readonly conversation: ConversationState;
  /** Shows the History tab. */
  readonly onHistory: () => void;
}

/** How many recent conversations a new one offers to open. */
const recentShown = 3;

/**
 * The bar above the conversation: who started it and when, or that it is new; Move to bin for its
 * starter and admins, after a question; and New conversation for those who may ask, once a
 * conversation is open.
 *
 * @param props - The conversation, the dashboard and whether the person may ask.
 * @param props.conversation - The open conversation.
 * @param props.dashboardId - The dashboard.
 * @param props.canAsk - Whether the person may ask.
 * @returns The bar.
 */
function ConversationBar({
  conversation,
  dashboardId,
  canAsk,
}: {
  readonly conversation: ConversationState;
  readonly dashboardId: string;
  readonly canAsk: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const { startNew } = conversation;
  const binned = useCallback(() => {
    setConfirming(false);
    startNew();
  }, [startNew]);
  const binning = useBinConversation(`/d/${dashboardId}`, binned);
  const [first] = conversation.questions;
  if (confirming && first)
    return (
      <div className={styles.bar}>
        <ConfirmBin
          question={first.question}
          onConfirm={() => binning.bin(first.conversationId)}
          onCancel={() => setConfirming(false)}
        />
      </div>
    );
  return (
    <div className={styles.bar}>
      <p className={styles.barText}>{binning.failure ?? startedLine(conversation)}</p>
      <div className={styles.barActions}>
        {first && conversation.loaded.canBin && (
          <Button size="small" disabled={binning.busy} onClick={() => setConfirming(true)}>
            Move to bin
          </Button>
        )}
        {canAsk && <NewButton conversation={conversation} />}
      </div>
    </div>
  );
}

/**
 * Who started the conversation, when, and how many questions it holds, or that it is new.
 *
 * @param conversation - The open conversation.
 * @returns Such as `Started by Ana, 4 Oct 09:12 · 3 questions`.
 */
function startedLine(conversation: ConversationState): string {
  const [first] = conversation.questions;
  const count = conversation.questions.length;
  if (!first) return 'New conversation';
  const when = instantLabel(first.askedAt, first.timeZone);
  return `Started by ${first.askedBy}, ${when} · ${count} ${count === 1 ? 'question' : 'questions'}`;
}

/**
 * New conversation: starts over. A new conversation already says so in its header line, so the
 * button shows only once a conversation is open.
 *
 * @param props - The conversation.
 * @param props.conversation - The open conversation.
 * @returns The button, or nothing while the conversation is new.
 */
function NewButton({ conversation }: { readonly conversation: ConversationState }) {
  const empty = conversation.conversationId === undefined && !conversation.live;
  if (empty) return null;
  return (
    <Button size="small" onClick={conversation.startNew}>
      New conversation
    </Button>
  );
}

/**
 * What a new conversation shows: what asking does, and the latest conversations to open.
 *
 * @param props - The dashboard, whether the person may ask, and the callbacks.
 * @param props.dashboardId - The dashboard.
 * @param props.timeZone - The time zone of the dates.
 * @param props.canAsk - Whether the person may ask.
 * @param props.onOpen - Opens a conversation.
 * @param props.onHistory - Shows the History tab.
 * @returns The empty state.
 */
function NewConversation({
  dashboardId,
  timeZone,
  canAsk,
  onOpen,
  onHistory,
}: {
  readonly dashboardId: string;
  readonly timeZone: string;
  readonly canAsk: boolean;
  readonly onOpen: (conversation: Conversation) => void;
  readonly onHistory: () => void;
}) {
  const { conversations } = useConversations(`/d/${dashboardId}`, '');
  return (
    <div className={styles.empty}>
      <p className={styles.meta}>
        {canAsk
          ? 'Ask about what the dashboard shows. Each question continues this conversation.'
          : 'No conversation is open.'}
      </p>
      {conversations.length > 0 && (
        <section className={styles.recent} aria-label="Recent conversations">
          <h3 className={styles.similarTitle}>Recent conversations</h3>
          {conversations.slice(0, recentShown).map((each) => (
            <button
              key={each.id}
              type="button"
              className={`${styles.similarItem} ${styles.recentItem}`}
              onClick={() => onOpen(each)}
            >
              <span className={styles.recentQuestion}>{each.question}</span>
              <span className={styles.recentMeta}>
                {each.startedBy}, {dayLabel(each.lastAt, timeZone)}
              </span>
            </button>
          ))}
          <button type="button" className={styles.linkButton} onClick={onHistory}>
            All {conversations.length} in History
          </button>
        </section>
      )}
    </div>
  );
}

/**
 * Follows the newest turn while the person is at the end of the conversation, and leaves the
 * scroll alone once they scroll up to read. Asking, or opening another conversation, goes to the
 * end; a question opened from a search is left in view.
 *
 * @param conversation - The open conversation.
 * @returns The ref and the scroll handler of the scrolling element.
 */
function useNewestInView(conversation: ConversationState) {
  const { conversationId, questions, live, flash } = conversation;
  const growth = `${questions.length}:${live?.text.length}:${live?.outcome?.ok}`;
  const asked = live?.question ?? questions.at(-1)?.question ?? '';
  return useFollowEnd<HTMLDivElement>({
    growth,
    count: questions.length + (live ? 1 : 0),
    restart: `${conversationId}:${asked}`,
    paused: flash !== undefined,
  });
}

/**
 * The turns of the conversation, each with the line saying the view changed since the one before.
 *
 * @param props - The conversation and what the page shows.
 * @param props.conversation - The open conversation.
 * @param props.data - The dashboard and the version shown.
 * @returns The turns.
 */
function Turns({
  conversation,
  data,
}: {
  readonly conversation: ConversationState;
  readonly data: DashboardData;
}) {
  const { questions, marks, flash, live, shown } = conversation;
  const { spec, version } = data.version;
  return (
    <>
      {questions.map((question, index) => {
        const before = questions[index - 1];
        const note = contextChange(before && askedContextOf(before), askedContextOf(question));
        return (
          <StoredTurn
            key={question.id}
            question={question}
            note={note}
            spec={spec}
            shownVersion={version}
            shown={marks?.questionId === question.id && marks.version === version}
            flashing={flash === question.id}
            onPick={conversation.setPicked}
          />
        );
      })}
      {live && <LiveTurn live={live} spec={spec} timeZone={shown.timeZone} />}
    </>
  );
}

/**
 * The foot of the tab: the earlier answers that look like the text typed and the question box, or
 * who can ask.
 *
 * @param props - The conversation and whether the person may ask.
 * @param props.conversation - The open conversation.
 * @param props.dashboardId - The dashboard.
 * @param props.canAsk - Whether the person may ask.
 * @returns The foot.
 */
function AskFoot({
  conversation,
  dashboardId,
  canAsk,
}: {
  readonly conversation: ConversationState;
  readonly dashboardId: string;
  readonly canAsk: boolean;
}) {
  const similar = useSimilar(dashboardId);
  const { shown } = conversation;
  if (!canAsk)
    return (
      <div className={styles.foot}>
        <WhoCanAsk />
      </div>
    );
  const open = ({ conversationId, id }: { conversationId: string; id: string }) =>
    conversation.show(conversationId, id);
  return (
    <div className={styles.foot}>
      <SimilarQuestions matches={similar.matches} timeZone={shown.timeZone} onOpen={open} />
      <AskForm
        label={shown.label}
        busy={conversation.answering}
        note={conversation.questions.length > 0 ? conversation.note : undefined}
        onAsk={conversation.send}
        onType={similar.onType}
      />
    </div>
  );
}

/**
 * The Ask tab.
 *
 * @param props - The dashboard, the version shown, the conversation and the History callback.
 * @returns The tab's content.
 */
export function AskTab({ conversation, onHistory, ...data }: AskTabProps) {
  const canAsk = useCanAsk();
  const sources = useSources(data.dashboard.id, data.version.version);
  const follow = useNewestInView(conversation);
  const explainOnly = sources?.every((source) => (source.accessLevel ?? 0) < 3) ?? false;
  const blank = conversation.questions.length === 0 && !conversation.live;
  const failed = conversation.loaded.failed;
  return (
    <div className={styles.tab}>
      <ConversationBar
        conversation={conversation}
        dashboardId={data.dashboard.id}
        canAsk={canAsk}
      />
      <div className={styles.scroll} ref={follow.ref} onScroll={follow.onScroll}>
        {explainOnly && sources && <ExplainOnlyCard sources={sources} />}
        {failed && <p className={styles.failure}>{failed}</p>}
        {blank && conversation.conversationId === undefined && (
          <NewConversation
            dashboardId={data.dashboard.id}
            timeZone={conversation.shown.timeZone}
            canAsk={canAsk}
            onOpen={(each) => conversation.show(each.id)}
            onHistory={onHistory}
          />
        )}
        <Turns conversation={conversation} data={data} />
        <NewBelow unseen={follow.unseen} noun="answer" onJump={follow.jump} />
      </div>
      <AskFoot conversation={conversation} dashboardId={data.dashboard.id} canAsk={canAsk} />
    </div>
  );
}
