/**
 * The History tab of a pinned dashboard: its past conversations, grouped by the day of their latest
 * question, with a search through every question and answer. Opening one shows it in the Ask tab.
 */
import type { Conversation } from '@quanthea/shared';
import { useMemo, useState } from 'react';
import { groupByDay } from '../../lib/day-groups.ts';
import { SearchIcon } from '../../ui/icons.tsx';
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
}

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
 * latest activity. In a search, the question that matched, when it is not the first.
 *
 * @param props - The conversation, the time zone, whether it is open, and the open callback.
 * @param props.conversation - The conversation.
 * @param props.timeZone - The time zone of the dates.
 * @param props.current - Whether the Ask tab shows it.
 * @param props.onOpen - Opens it.
 * @returns The row.
 */
function ConversationRow({
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
    <li className={styles.row}>
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
          started {instantLabel(conversation.startedAt, timeZone)} ·{' '}
          {rowMeta(conversation, timeZone)}
        </span>
      </button>
    </li>
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
}: Omit<HistoryTabProps, 'dashboardId'> & {
  readonly conversations: readonly Conversation[];
  readonly searching: boolean;
  readonly loading: boolean;
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
              />
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}

/**
 * The History tab: a search box, and the past conversations.
 *
 * @param props - The dashboard, the open conversation, and the open callback.
 * @returns The tab's content.
 */
export function HistoryTab({ dashboardId, timeZone, openId, onOpen }: HistoryTabProps) {
  const [search, setSearch] = useState('');
  const { conversations, failed, loading } = useConversations(dashboardId, search);
  return (
    <div className={styles.tab}>
      <search className={styles.search}>
        <SearchIcon />
        <input
          type="search"
          aria-label="Search past conversations"
          placeholder="Search questions and answers"
          className={styles.searchInput}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            // Escape clears the words first; the panel closes on Escape once it is empty.
            if (event.key !== 'Escape' || search === '') return;
            event.preventDefault();
            setSearch('');
          }}
        />
      </search>
      {failed && <p className={styles.failure}>{failed}</p>}
      <div className={styles.results} aria-busy={loading}>
        <ConversationGroups
          conversations={conversations}
          searching={search.trim() !== ''}
          loading={loading}
          timeZone={timeZone}
          openId={openId}
          onOpen={onOpen}
        />
      </div>
    </div>
  );
}
