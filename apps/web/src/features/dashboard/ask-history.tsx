/**
 * The History tab of a pinned dashboard: its past conversations, grouped by the day of their latest
 * question, with a search through every question and answer. Opening one shows it in the Ask tab.
 */
import type { Conversation } from '@quanthea/shared';
import { useCallback, useMemo, useState } from 'react';
import { groupByDay } from '../../lib/day-groups.ts';
import { SearchIcon } from '../../ui/icons.tsx';
import { BinButton, ConfirmBin, useBinConversation } from './ask-bin.tsx';
import { useConversations } from './ask-state.ts';
import { instantLabel } from './ask-words.ts';
import styles from './history.module.css';

/** Props of {@link HistoryTab}. */
interface HistoryTabProps {
  /** The dashboard. */
  readonly dashboardId: string;
  /** The time zone of the dates and of the days they are grouped by: the Ask tab's. */
  readonly timeZone: string;
  /** The conversation the Ask tab shows, if any. */
  readonly openId: string | undefined;
  /** Opens a conversation in the Ask tab, at a question when a search found one. */
  readonly onOpen: (conversationId: string, questionId: string | undefined) => void;
  /** Called once a conversation is in the bin. */
  readonly onBinned: (conversationId: string) => void;
}

/** What a row needs to move its conversation to the bin. */
type RowBin = ReturnType<typeof useBinConversation>;

/**
 * How many questions a conversation holds, and when the latest was asked.
 *
 * @param conversation - The conversation.
 * @param timeZone - The time zone of the date.
 * @returns Such as `3 questions · last 26 Sep 14:10`.
 */
function rowMeta(conversation: Conversation, timeZone: string): string {
  const count = `${conversation.count} ${conversation.count === 1 ? 'question' : 'questions'}`;
  return `${count} · last ${instantLabel(conversation.lastAt, timeZone)}`;
}

/**
 * One past conversation: its first question, who started it, when, how many questions and the
 * latest activity. In a search, the question that matched, when it is not the first. Its starter
 * and admins may move it to the bin, after a question.
 *
 * @param props - The conversation, the time zone, whether it is open, and the callbacks.
 * @param props.conversation - The conversation.
 * @param props.timeZone - The time zone of the dates.
 * @param props.current - Whether the Ask tab shows it.
 * @param props.onOpen - Opens it.
 * @param props.binning - Moves it to the bin.
 * @returns The row.
 */
function ConversationRow({
  conversation,
  timeZone,
  current,
  onOpen,
  binning,
}: {
  readonly conversation: Conversation;
  readonly timeZone: string;
  readonly current: boolean;
  readonly onOpen: HistoryTabProps['onOpen'];
  readonly binning: RowBin;
}) {
  const [confirming, setConfirming] = useState(false);
  if (confirming)
    return (
      <li className={styles.row}>
        <ConfirmBin
          question={conversation.question}
          onConfirm={() => binning.bin(conversation.id)}
          onCancel={() => setConfirming(false)}
        />
      </li>
    );
  return (
    <li className={styles.row}>
      <ConversationItem
        conversation={conversation}
        timeZone={timeZone}
        current={current}
        onOpen={onOpen}
      />
      {conversation.canBin && (
        <BinButton question={conversation.question} onClick={() => setConfirming(true)} />
      )}
    </li>
  );
}

/**
 * The button that opens a past conversation: its first question on one line, and who started it,
 * when, how many questions and the latest activity on the line below.
 *
 * @param props - The conversation, the time zone, whether it is open, and the open callback.
 * @param props.conversation - The conversation.
 * @param props.timeZone - The time zone of the dates.
 * @param props.current - Whether the Ask tab shows it.
 * @param props.onOpen - Opens it.
 * @returns The button.
 */
function ConversationItem({
  conversation,
  timeZone,
  current,
  onOpen,
}: {
  readonly conversation: Conversation;
  readonly timeZone: string;
  readonly current: boolean;
  readonly onOpen: HistoryTabProps['onOpen'];
}) {
  const { match } = conversation;
  const other = match && match.questionId !== conversation.id ? match : null;
  return (
    <button
      type="button"
      className={styles.item}
      aria-current={current || undefined}
      onClick={() => onOpen(conversation.id, match?.questionId)}
    >
      <span className={styles.itemTitle}>{conversation.question}</span>
      {other && <span className={styles.matched}>Matches: {other.question}</span>}
      <span className={styles.itemMeta}>
        <span className={styles.owner}>{conversation.startedBy}</span>
        started {instantLabel(conversation.startedAt, timeZone)} · {rowMeta(conversation, timeZone)}
      </span>
    </button>
  );
}

/**
 * The conversations, grouped by the day of their latest question, or why there are none.
 *
 * @param props - The conversations, whether they are a search's and still loading, and the rows'
 *   props.
 * @returns The list.
 */
function ConversationGroups({
  conversations,
  searching,
  loading,
  timeZone,
  openId,
  onOpen,
  binning,
}: Omit<HistoryTabProps, 'dashboardId' | 'onBinned'> & {
  readonly conversations: readonly Conversation[];
  readonly searching: boolean;
  readonly loading: boolean;
  readonly binning: RowBin;
}) {
  const groups = useMemo(
    () => groupByDay(conversations, (each) => each.lastAt, new Date(), timeZone),
    [conversations, timeZone],
  );
  if (groups.length === 0 && loading) return null;
  if (groups.length === 0)
    return (
      <p className={styles.empty}>
        {searching ? 'No conversation matches.' : 'No one has asked about this dashboard yet.'}
      </p>
    );
  return (
    <nav className={styles.groups} aria-label="Past conversations">
      {groups.map((group) => (
        <section key={group.label} className={styles.group}>
          <h3 className={styles.groupLabel}>{group.label}</h3>
          <ul className={styles.list}>
            {group.items.map((each) => (
              <ConversationRow
                key={each.id}
                conversation={each}
                timeZone={timeZone}
                current={each.id === openId}
                onOpen={onOpen}
                binning={binning}
              />
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}

/**
 * The search box of History. Escape clears the words first; the panel closes on Escape once it is
 * empty.
 *
 * @param props - The words and the callback.
 * @param props.search - The words typed.
 * @param props.onSearch - Receives the words.
 * @returns The search box.
 */
function HistorySearch({
  search,
  onSearch,
}: {
  readonly search: string;
  readonly onSearch: (search: string) => void;
}) {
  return (
    <search className={styles.search}>
      <SearchIcon />
      <input
        type="search"
        aria-label="Search past conversations"
        placeholder="Search questions and answers"
        className={styles.searchInput}
        value={search}
        onChange={(event) => onSearch(event.target.value)}
        onKeyDown={(event) => {
          // Escape clears the words first; the panel closes on Escape once it is empty.
          if (event.key !== 'Escape' || search === '') return;
          event.preventDefault();
          onSearch('');
        }}
      />
    </search>
  );
}

/**
 * The History tab: a search box, and the past conversations.
 *
 * @param props - The dashboard, the open conversation, and the open and binned callbacks.
 * @returns The tab's content.
 */
export function HistoryTab({ dashboardId, timeZone, openId, onOpen, onBinned }: HistoryTabProps) {
  const [search, setSearch] = useState('');
  const { conversations, failed, loading, reload } = useConversations(dashboardId, search);
  const binned = useCallback(
    (conversationId: string) => {
      reload();
      onBinned(conversationId);
    },
    [reload, onBinned],
  );
  const binning = useBinConversation(dashboardId, binned);
  return (
    <div className={styles.tab}>
      <HistorySearch search={search} onSearch={setSearch} />
      {failed && <p className={styles.failure}>{failed}</p>}
      {binning.failure && <p className={styles.failure}>{binning.failure}</p>}
      <div className={styles.results} aria-busy={loading || binning.busy}>
        <ConversationGroups
          conversations={conversations}
          searching={search.trim() !== ''}
          loading={loading}
          timeZone={timeZone}
          openId={openId}
          onOpen={onOpen}
          binning={binning}
        />
      </div>
    </div>
  );
}
