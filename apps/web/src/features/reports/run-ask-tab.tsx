/**
 * The Ask tab of a run: one conversation, newest at the bottom, and for analysts and above the
 * question box pinned under it. Each question continues the conversation, about the run as the
 * report froze it. New conversation starts over; History holds the others.
 */
import type { ReportRunDetail, ReportSpec } from '@quanthea/shared';
import { useCallback, useState } from 'react';
import { Button } from '../../ui/button.tsx';
import { NewBelow } from '../../ui/new-below.tsx';
import { useFollowEnd } from '../../ui/use-follow-end.ts';
import {
  AskForm,
  ConfirmBin,
  dayLabel,
  ExplainOnlyCard,
  instantLabel,
  SimilarQuestions,
  useBinConversation,
  useCanAsk,
  useConversations,
  WhoCanAsk,
} from '../dashboard/index.ts';
import styles from './run-ask.module.css';
import { useRunSimilar, useRunSources } from './run-ask-state.ts';
import { LiveRunTurn, StoredRunTurn } from './run-turns.tsx';
import type { RunConversationState } from './use-run-conversation.ts';

/** How many recent conversations a new one offers to open. */
const recentShown = 3;

/** Props of {@link RunAskTab}. */
interface RunAskTabProps {
  /** The run. */
  readonly run: ReportRunDetail;
  /** The open conversation. */
  readonly conversation: RunConversationState;
  /** Shows the History tab. */
  readonly onHistory: () => void;
}

/**
 * Who started the conversation, when, and how many questions it holds, or that it is new.
 *
 * @param conversation - The open conversation.
 * @returns Such as `Started by Ana, 4 Oct 09:12 · 3 questions`.
 */
function startedLine(conversation: RunConversationState): string {
  const [first] = conversation.questions;
  const count = conversation.questions.length;
  if (!first) return 'New conversation';
  const when = instantLabel(first.askedAt, first.timeZone);
  return `Started by ${first.askedBy}, ${when} · ${count} ${count === 1 ? 'question' : 'questions'}`;
}

/**
 * The bar above the conversation: who started it, Move to bin for its starter and admins, and New
 * conversation once one is open.
 *
 * @param props - The conversation and whether the person may ask.
 * @param props.conversation - The open conversation.
 * @param props.canAsk - Whether the person may ask.
 * @returns The bar.
 */
function ConversationBar({
  conversation,
  canAsk,
}: {
  readonly conversation: RunConversationState;
  readonly canAsk: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const { startNew } = conversation;
  const binned = useCallback(() => {
    setConfirming(false);
    startNew();
  }, [startNew]);
  const binning = useBinConversation(conversation.base, binned);
  const [first] = conversation.questions;
  const open = conversation.conversationId !== undefined || conversation.live !== undefined;
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
        {canAsk && open && (
          <Button size="small" onClick={startNew}>
            New conversation
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * What a new conversation shows: what asking does, and the latest conversations to open.
 *
 * @param props - The conversation, the time zone, whether the person may ask, and History.
 * @param props.conversation - The open conversation.
 * @param props.timeZone - The time zone of the dates.
 * @param props.canAsk - Whether the person may ask.
 * @param props.onHistory - Shows the History tab.
 * @returns The empty state.
 */
function NewConversation({
  conversation,
  timeZone,
  canAsk,
  onHistory,
}: {
  readonly conversation: RunConversationState;
  readonly timeZone: string;
  readonly canAsk: boolean;
  readonly onHistory: () => void;
}) {
  const { conversations } = useConversations(conversation.base, '');
  return (
    <div className={styles.empty}>
      <p className={styles.meta}>
        {canAsk
          ? 'Ask about this run, or ask what to watch. Answers read the results the report froze.'
          : 'No conversation is open.'}
      </p>
      {conversations.length > 0 && (
        <section className={styles.recent} aria-label="Recent conversations">
          <h3 className={styles.watchingTitle}>Recent conversations</h3>
          {conversations.slice(0, recentShown).map((each) => (
            <button
              key={each.id}
              type="button"
              className={styles.recentItem}
              onClick={() => conversation.show(each.id)}
            >
              <span className={styles.recentQuestion}>{each.question}</span>
              <span className={styles.meta}>
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
function useNewestInView(conversation: RunConversationState) {
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
 * The turns of the conversation.
 *
 * @param props - The conversation, the spec and the time zone.
 * @param props.conversation - The open conversation.
 * @param props.spec - The report's spec.
 * @param props.timeZone - The time zone of the times.
 * @returns The turns.
 */
function Turns({
  conversation,
  spec,
  timeZone,
}: {
  readonly conversation: RunConversationState;
  readonly spec: ReportSpec;
  readonly timeZone: string;
}) {
  const { questions, flash, live } = conversation;
  return (
    <>
      {questions.map((question) => (
        <StoredRunTurn
          key={question.id}
          question={question}
          spec={spec}
          flashing={flash === question.id}
        />
      ))}
      {live && <LiveRunTurn live={live} spec={spec} timeZone={timeZone} />}
    </>
  );
}

/**
 * The foot of the tab: the earlier answers that look like the text typed and the question box,
 * or who can ask.
 *
 * @param props - The run, the conversation and whether the person may ask.
 * @param props.run - The run.
 * @param props.conversation - The open conversation.
 * @param props.canAsk - Whether the person may ask.
 * @returns The foot.
 */
function AskFoot({
  run,
  conversation,
  canAsk,
}: {
  readonly run: ReportRunDetail;
  readonly conversation: RunConversationState;
  readonly canAsk: boolean;
}) {
  const similar = useRunSimilar(conversation.base);
  if (!canAsk)
    return (
      <div className={styles.foot}>
        <WhoCanAsk subject="this run" />
      </div>
    );
  const label = `Ask about ${run.period.label.split(',')[0]}, as the report froze it`;
  return (
    <div className={styles.foot}>
      <SimilarQuestions
        matches={similar.matches}
        timeZone={run.spec.schedule.timezone}
        onOpen={(match) => conversation.show(match.conversationId, match.id)}
      />
      <AskForm
        label={label}
        busy={conversation.answering}
        note={undefined}
        placeholder="Ask, or ask what to watch…"
        onAsk={conversation.send}
        onType={similar.onType}
      />
    </div>
  );
}

/**
 * The Ask tab of a run.
 *
 * @param props - The run, the conversation and the History callback.
 * @returns The tab's content.
 */
export function RunAskTab({ run, conversation, onHistory }: RunAskTabProps) {
  const canAsk = useCanAsk();
  const sources = useRunSources(conversation.base);
  const follow = useNewestInView(conversation);
  const shapesOnly = sources?.every((source) => (source.accessLevel ?? 0) < 3) ?? false;
  const blank = conversation.questions.length === 0 && !conversation.live;
  const timeZone = run.spec.schedule.timezone;
  return (
    <div className={styles.tab}>
      <ConversationBar conversation={conversation} canAsk={canAsk} />
      <div className={styles.scroll} ref={follow.ref} onScroll={follow.onScroll}>
        {shapesOnly && sources && <ExplainOnlyCard sources={sources} subject="report" />}
        {conversation.loaded.failed && (
          <p className={styles.failure}>{conversation.loaded.failed}</p>
        )}
        {blank && conversation.conversationId === undefined && (
          <NewConversation
            conversation={conversation}
            timeZone={timeZone}
            canAsk={canAsk}
            onHistory={onHistory}
          />
        )}
        <Turns conversation={conversation} spec={run.spec} timeZone={timeZone} />
        <NewBelow unseen={follow.unseen} noun="answer" onJump={follow.jump} />
      </div>
      <AskFoot run={run} conversation={conversation} canAsk={canAsk} />
    </div>
  );
}
