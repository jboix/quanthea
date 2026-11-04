import type { ReactNode } from 'react';
import { LimitCard } from './limit-card.tsx';
import type { ThreadPart } from './messages.ts';
import { RepairCard } from './repair-card.tsx';
import { UnreachableCard } from './unreachable-card.tsx';

/** What the cards that end a run need of the conversation. */
export interface StopContext {
  /** Whether this message is the latest answer. */
  readonly answerable: boolean;
  /** Whether the part is the message's last, so nothing continued it. */
  readonly last?: boolean;
  /** Whether a run or a decision is on its way. */
  readonly busy: boolean;
  /** Starts a new run: continues a paused turn, or builds again. */
  readonly onTryAgain: () => void;
}

/**
 * The card of a part that ends a turn, whose action shows only while nothing came after it: a
 * pause at a limit, or connectors that do not answer.
 *
 * @param part - The data part.
 * @param key - Its key.
 * @param context - The conversation context.
 * @returns The card, or `undefined` for another part.
 */
function endCard(part: ThreadPart, key: string, context: StopContext): ReactNode {
  const { busy, onTryAgain } = context;
  const answerable = context.answerable && context.last === true;
  if (part.type === 'data-limit')
    return (
      <LimitCard
        key={key}
        limit={part.data}
        answerable={answerable}
        busy={busy}
        onContinue={onTryAgain}
      />
    );
  if (part.type !== 'data-unreachable') return undefined;
  const { connectors } = part.data;
  return (
    <UnreachableCard
      key={key}
      connectors={connectors}
      answerable={answerable}
      busy={busy}
      onTryAgain={onTryAgain}
    />
  );
}

/**
 * The card of a part that ends or stops a run: a repair try, a pause at a limit, or connectors
 * that do not answer.
 *
 * @param part - The data part.
 * @param key - Its key.
 * @param context - The conversation context.
 * @returns The card, or `undefined` for another part.
 */
export function stopCard(part: ThreadPart, key: string, context: StopContext): ReactNode {
  if (part.type !== 'data-repair') return endCard(part, key, context);
  const { answerable, busy, onTryAgain } = context;
  return (
    <RepairCard
      key={key}
      repair={part.data}
      answerable={answerable}
      busy={busy}
      onTryAgain={onTryAgain}
    />
  );
}
