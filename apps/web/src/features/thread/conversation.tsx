import type { AccessLevel, PlanView, ThreadData } from '@querent/shared';
import type { ReactNode } from 'react';
import styles from './conversation.module.css';
import { DiffCard } from './diff-card.tsx';
import {
  buildTools,
  exploreTools,
  isToolPart,
  readableText,
  type ThreadMessage,
  type ThreadPart,
  type ToolPart,
  toolName,
} from './messages.ts';
import { PlanCard } from './plan-card.tsx';
import { TextBlock } from './text-block.tsx';
import { BuildLog, ExploreLog } from './tool-logs.tsx';

/** What the conversation needs besides the messages: plan statuses and the thread's actions. */
export interface ConversationContext {
  /** The thread's plans, for their statuses. */
  readonly plans: readonly PlanView[];
  /** The access level of each connector. */
  readonly levels: Readonly<Record<string, AccessLevel>>;
  /** The latest version of the dashboard. */
  readonly latestVersion: number;
  /** Whether a run or a decision is on its way. */
  readonly busy: boolean;
  /** Approves a plan. */
  readonly onApprove: (planId: string) => void;
  /** Rejects a plan and asks for changes. */
  readonly onEditPlan: (planId: string) => void;
  /** Restores a version. */
  readonly onUndo: (version: number) => void;
  /** Shows a version in the right pane. */
  readonly onCompare: (version: number) => void;
}

/**
 * The plan card of a plan part.
 *
 * @param data - The part's data.
 * @param key - The element key.
 * @param context - The conversation context.
 * @returns The card.
 */
function planCard(data: ThreadData['plan'], key: string, context: ConversationContext): ReactNode {
  const status = context.plans.find((plan) => plan.id === data.planId)?.status ?? 'pending';
  return (
    <PlanCard
      key={key}
      plan={data.body}
      planId={data.planId}
      status={status}
      levels={context.levels}
      busy={context.busy}
      onApprove={context.onApprove}
      onEdit={context.onEditPlan}
    />
  );
}

/**
 * The diff card of a diff part.
 *
 * @param data - The part's data.
 * @param key - The element key.
 * @param context - The conversation context.
 * @returns The card, or nothing when no panel changed.
 */
function diffCard(data: ThreadData['diff'], key: string, context: ConversationContext): ReactNode {
  if (data.panels.length === 0) return null;
  const { latestVersion, busy, onUndo, onCompare } = context;
  return (
    <DiffCard
      key={key}
      diff={data}
      latestVersion={latestVersion}
      busy={busy}
      onUndo={onUndo}
      onCompare={onCompare}
    />
  );
}

/**
 * Renders one non-explore part.
 *
 * @param part - The part.
 * @param key - Its key.
 * @param context - The conversation context.
 * @returns The element, or nothing for parts that show no card.
 */
function partView(part: ThreadPart, key: string, context: ConversationContext): ReactNode {
  if (part.type === 'text') {
    return readableText(part.text) === '' ? null : <TextBlock key={key} text={part.text} />;
  }
  if (part.type === 'data-plan') return planCard(part.data, key, context);
  if (part.type === 'data-diff') return diffCard(part.data, key, context);
  if (isToolPart(part) && buildTools.has(toolName(part))) return <BuildLog key={key} part={part} />;
  return null;
}

/**
 * Renders an assistant message: explore calls grouped into one log until something else shows,
 * then each other part in order.
 *
 * @param message - The message.
 * @param context - The conversation context.
 * @returns The elements.
 */
function assistantParts(message: ThreadMessage, context: ConversationContext): ReactNode[] {
  const nodes: ReactNode[] = [];
  let explored: ToolPart[] = [];
  const flush = () => {
    if (explored.length > 0)
      nodes.push(<ExploreLog key={`explore-${nodes.length}`} parts={explored} />);
    explored = [];
  };
  message.parts.forEach((part, index) => {
    if (isToolPart(part) && exploreTools.has(toolName(part))) {
      explored.push(part);
      return;
    }
    const node = partView(part, `${message.id}-${index}`, context);
    if (node === null) return;
    flush();
    nodes.push(node);
  });
  flush();
  return nodes;
}

/**
 * A person's message, with the panels it mentions.
 *
 * @param props - The message.
 * @param props.message - The user message.
 * @returns The bubble.
 */
function UserBubble({ message }: { readonly message: ThreadMessage }) {
  const text = message.parts
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('\n');
  const mentions = message.metadata?.mentions ?? [];
  let rest = text;
  for (const mention of mentions) rest = rest.replace(`@${mention.title}`, '');
  return (
    <div className={styles.user}>
      {mentions.map((mention) => (
        <span key={mention.panelId} className={styles.mention}>
          @{mention.title}
        </span>
      ))}
      {mentions.length > 0 ? ' ' : ''}
      {rest.trim()}
    </div>
  );
}

/** Props of {@link Conversation}. */
interface ConversationProps extends ConversationContext {
  /** The messages. */
  readonly messages: readonly ThreadMessage[];
}

/**
 * The thread's messages, the person's on the right, the agent's with its logs and cards.
 *
 * @param props - The messages and the conversation context.
 * @returns The conversation.
 */
export function Conversation({ messages, ...context }: ConversationProps) {
  return (
    <ol className={styles.messages}>
      {messages.map((message) => (
        <li key={message.id} className={styles.message} data-role={message.role}>
          {message.role === 'user' ? (
            <UserBubble message={message} />
          ) : (
            assistantParts(message, context)
          )}
        </li>
      ))}
    </ol>
  );
}
