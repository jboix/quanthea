import { addUsage, pricesCheckedOn, type ThreadDetail, type TurnUsage } from '@quanthea/shared';
import type { ReactNode } from 'react';
import { TitleHeader } from '../../ui/title-header.tsx';
import type { ThreadMessage } from './messages.ts';
import styles from './thread.module.css';
import { costText } from './usage-line.tsx';

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
 * @param props - The thread, its messages, and the button that opens the draft on a phone.
 * @param props.thread - The thread.
 * @param props.messages - The messages, as the chat holds them.
 * @param props.openDraft - The button that opens the draft where it does not fit beside.
 * @returns The header.
 */
export function ThreadHeader({
  thread,
  messages,
  openDraft,
}: {
  readonly thread: ThreadDetail;
  readonly messages: readonly ThreadMessage[];
  readonly openDraft: ReactNode;
}) {
  const connectors = thread.connectors.map((connector) => connector.name).join(' · ');
  return (
    <TitleHeader
      className={styles.head}
      level={1}
      size="compact"
      title={thread.title ?? firstQuestion(messages) ?? 'New thread'}
      actions={
        <>
          {openDraft}
          <ThreadCost messages={messages} />
          <span className={styles.connectors} title={connectors}>
            {connectors}
          </span>
        </>
      }
    />
  );
}
