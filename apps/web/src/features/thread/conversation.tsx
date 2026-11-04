import type { AccessLevel, DefinitionVersion, Plan, PlanView, ThreadData } from '@quanthea/shared';
import type { ReactNode } from 'react';
import { AlertPlanCard } from './alert-cards.tsx';
import { AskCard } from './ask-card.tsx';
import { WorkView } from './build-card.tsx';
import { buildsPanels, plansBuilt } from './build-progress.ts';
import styles from './conversation.module.css';
import { DefinitionProposalsCard } from './definition-proposals.tsx';
import { DiffCard } from './diff-card.tsx';
import { LinkProposalCard } from './link-card.tsx';
import { matchesView } from './matches-card.tsx';
import {
  isToolPart,
  readableText,
  type ThreadMessage,
  type ThreadPart,
  type ToolPart,
  toolName,
} from './messages.ts';
import { PersonMessage } from './person-message.tsx';
import { PlanCard } from './plan-card.tsx';
import type { DraftPanel } from './plan-changes.ts';
import { ReportPlanCard } from './report-cards.tsx';
import { stopCard } from './stop-cards.tsx';
import { TextBlock } from './text-block.tsx';
import { UsageLine } from './usage-line.tsx';
import { isWorkPart } from './work-summary.ts';

/** What the conversation needs besides the messages: plan statuses and the thread's actions. */
export interface ConversationContext {
  /** The thread's plans, for their statuses. */
  readonly plans: readonly PlanView[];
  /** The access level of each connector. */
  readonly levels: Readonly<Record<string, AccessLevel>>;
  /** The definitions there are, for the marks of a plan's panels. */
  readonly definitions?: readonly DefinitionVersion[] | undefined;
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
  /** Sends an answer to the agent's question. */
  readonly onAnswer: (answer: string) => void;
  /** Starts the draft from a copy of a pinned dashboard. */
  readonly onStartFrom: (dashboardId: string) => void;
  /** Asks the agent for a new dashboard after the matches. */
  readonly onBuildNew: () => void;
  /** Starts a new run with fresh repair attempts and counts after a build stopped or paused. */
  readonly onTryAgain: () => void;
  /** Stops the run under way. */
  readonly onStop?: (() => void) | undefined;
  /** Whether the thread has a draft, which settles the matches card. */
  readonly hasDraft: boolean;
  /** The latest draft's panels, which a waiting plan reads as changes to. */
  readonly draftPanels?: readonly DraftPanel[] | undefined;
}

/** The conversation context of one message's parts. */
interface PartContext extends ConversationContext {
  /** Whether a question in this message still waits for an answer. */
  readonly answerable: boolean;
  /** Whether the agent is still writing this message. */
  readonly live: boolean;
  /** Whether the part is the message's last, so nothing continued it. */
  readonly last?: boolean;
  /** Whether the part is text the agent wrote on its way, with more work after it. */
  readonly narration?: boolean;
  /** The approved plan the message builds, if it builds one. */
  readonly building?: Plan | undefined;
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
      definitions={context.definitions}
      busy={context.busy}
      onApprove={context.onApprove}
      onEdit={context.onEditPlan}
      draftPanels={status === 'pending' ? context.draftPanels : undefined}
    />
  );
}

/**
 * The card of an alert plan part.
 *
 * @param data - The part's data.
 * @param key - The element key.
 * @param context - The conversation context.
 * @returns The card.
 */
function alertPlanCard(
  data: ThreadData['alertPlan'],
  key: string,
  context: ConversationContext,
): ReactNode {
  const status = context.plans.find((plan) => plan.id === data.planId)?.status ?? 'pending';
  const { busy, onApprove, onEditPlan } = context;
  return (
    <AlertPlanCard
      key={key}
      data={data}
      status={status}
      busy={busy}
      onApprove={onApprove}
      onEdit={onEditPlan}
    />
  );
}

/**
 * The card of a report plan part.
 *
 * @param data - The part's data.
 * @param key - The element key.
 * @param context - The conversation context.
 * @returns The card.
 */
function reportPlanCard(
  data: ThreadData['reportPlan'],
  key: string,
  context: ConversationContext,
): ReactNode {
  const status = context.plans.find((plan) => plan.id === data.planId)?.status ?? 'pending';
  const { busy, onApprove, onEditPlan } = context;
  return (
    <ReportPlanCard
      key={key}
      data={data}
      status={status}
      busy={busy}
      onApprove={onApprove}
      onEdit={onEditPlan}
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
 * Renders a tool call that shows on its own: a question card. Explore calls and writes fold into
 * the work line.
 *
 * @param part - The tool part.
 * @param key - Its key.
 * @param context - The conversation context.
 * @returns The element, or nothing for tools that show no card.
 */
function toolView(part: ToolPart, key: string, context: PartContext): ReactNode {
  const name = toolName(part);
  if (name === 'ask_person') {
    return (
      <AskCard key={key} part={part} answerable={context.answerable} onAnswer={context.onAnswer} />
    );
  }
  return null;
}

/**
 * Renders a plan card of any kind of thread.
 *
 * @param part - The data part.
 * @param key - Its key.
 * @param context - The conversation context.
 * @returns The card, or `undefined` when the part is no plan.
 */
function planView(part: ThreadPart, key: string, context: PartContext): ReactNode | undefined {
  if (part.type === 'data-plan') return planCard(part.data, key, context);
  if (part.type === 'data-alertPlan') return alertPlanCard(part.data, key, context);
  if (part.type === 'data-reportPlan') return reportPlanCard(part.data, key, context);
  return undefined;
}

/**
 * Renders a proposal the person decides on: showing an alert on a panel, or definitions to save.
 *
 * @param part - The data part.
 * @param key - Its key.
 * @returns The card, or `undefined` when the part is no proposal.
 */
function proposalView(part: ThreadPart, key: string): ReactNode | undefined {
  if (part.type === 'data-linkProposal') return <LinkProposalCard key={key} data={part.data} />;
  if (part.type === 'data-definitionProposals')
    return <DefinitionProposalsCard key={key} data={part.data} />;
  return undefined;
}

/**
 * Renders a card of the agent's own: matches, a plan, a diff, a repair try, a pause, connectors
 * that do not answer.
 *
 * @param part - The data part.
 * @param key - Its key.
 * @param context - The conversation context.
 * @returns The card, or nothing when there is nothing to show.
 */
function dataView(part: ThreadPart, key: string, context: PartContext): ReactNode {
  const plan = planView(part, key, context);
  if (plan !== undefined) return plan;
  if (part.type === 'data-diff') return diffCard(part.data, key, context);
  const stop = stopCard(part, key, context);
  if (stop !== undefined) return stop;
  return proposalView(part, key) ?? matchesView(part, key, context);
}

/**
 * Renders one non-explore part.
 *
 * @param part - The part.
 * @param key - Its key.
 * @param context - The conversation context.
 * @returns The element, or nothing for parts that show no card.
 */
function partView(part: ThreadPart, key: string, context: PartContext): ReactNode {
  if (part.type === 'text') {
    if (readableText(part.text) === '') return null;
    return <TextBlock key={key} text={part.text} narration={context.narration === true} />;
  }
  if (part.type.startsWith('data-')) return dataView(part, key, context);
  return isToolPart(part) ? toolView(part, key, context) : null;
}

/**
 * The context of one part of a message: whether it is the last part, and whether it is text
 * the agent wrote on its way, with more work after it.
 *
 * @param message - The message.
 * @param index - The part's position.
 * @param lastWork - The position of the message's last work part, -1 for none.
 * @param context - The message's context.
 * @returns The part's context.
 */
function placed(
  message: ThreadMessage,
  index: number,
  lastWork: number,
  context: PartContext,
): PartContext {
  return { ...context, last: index === message.parts.length - 1, narration: index < lastWork };
}

/**
 * The agent's work in a message, as a build card or one folded line.
 *
 * @param message - The message, for its metadata.
 * @param parts - The work parts.
 * @param key - The element key.
 * @param live - Whether the agent is still at it.
 * @param context - The part context, for the plan it builds and Stop.
 * @returns The element.
 */
function workView(
  message: ThreadMessage,
  parts: ThreadPart[],
  key: string,
  live: boolean,
  context: PartContext,
): ReactNode {
  const { building, onStop } = context;
  const { metadata } = message;
  return <WorkView key={key} {...{ parts, live, building, metadata, onStop }} />;
}

/**
 * Renders an assistant message: the agent's work folded into one line until something else shows
 * (its words, a plan, a question, a diff), then that, in order.
 *
 * @param message - The message.
 * @param context - The conversation context.
 * @returns The elements.
 */
function assistantParts(message: ThreadMessage, context: PartContext): ReactNode[] {
  const nodes: ReactNode[] = [];
  let work: ThreadPart[] = [];
  const flush = (live: boolean) => {
    if (work.length > 0) nodes.push(workView(message, work, `work-${nodes.length}`, live, context));
    work = [];
  };
  const lastWork = message.parts.findLastIndex(isWorkPart);
  message.parts.forEach((part, index) => {
    if (isWorkPart(part)) {
      work.push(part);
      return;
    }
    const node = partView(
      part,
      `${message.id}-${index}`,
      placed(message, index, lastWork, context),
    );
    if (node === null) return;
    flush(false);
    nodes.push(node);
  });
  flush(context.live);
  return nodes;
}

/** Props of {@link Conversation}. */
interface ConversationProps extends ConversationContext {
  /** The messages. */
  readonly messages: readonly ThreadMessage[];
}

/**
 * The thread's messages, the person's on the right, the agent's with its logs and cards. A build
 * card says what its answer cost, so that answer has no usage line.
 *
 * @param props - The messages and the conversation context.
 * @returns The conversation.
 */
export function Conversation({ messages, ...context }: ConversationProps) {
  const builds = plansBuilt(messages, context.plans);
  return (
    <ol className={styles.messages}>
      {messages.map((message, index) => {
        const building = builds[index];
        const costed = building !== undefined && buildsPanels(message.parts);
        return (
          <li key={message.id} className={styles.message} data-role={message.role}>
            {message.role === 'user' ? (
              <PersonMessage message={message} actions={context} />
            ) : (
              [
                ...assistantParts(message, {
                  ...context,
                  answerable: index === messages.length - 1 && !context.busy,
                  live: index === messages.length - 1 && context.busy,
                  building,
                }),
                costed ? null : <UsageLine key="usage" usage={message.metadata?.usage} />,
              ]
            )}
          </li>
        );
      })}
    </ol>
  );
}
